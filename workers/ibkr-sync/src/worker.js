// ibkr-sync — ogni mattina scarica il report Flex di IBKR e aggiorna il portafoglio su Firebase.
// Ogni 15 minuti controlla anche le soglie di prezzo delle watchlist e manda le notifiche push.
// Nessun indirizzo pubblico: parte solo dal cron di Cloudflare (vedi wrangler.jsonc).
//
// Secret (wrangler secret put …), mai nel repository:
//   FIREBASE_SA     JSON dell'account di servizio Firebase
//   IBKR_TOKEN      token del Flex Web Service
//   IBKR_QUERY_ID   id della Flex Query
//   UID             utente Firebase proprietario del conto IBKR
//   PORTFOLIO_ID    portafoglio IBKR dentro portfolio_state
//   VAPID_PRIVATE   chiave privata VAPID per le notifiche push (la pubblica è in VAPID_PUBLIC)
// Variabili: DB_URL; DRY_RUN = "1" per calcolare senza scrivere; EMULATOR = "1" per gli emulatori locali.

import { parseFlex } from '../../../app/src/domain/ibkr/flex.ts'
import { applyFlexOrders } from '../../../app/src/domain/ibkr/sync.ts'
import { alertText, checkAlerts } from '../../../app/src/domain/watchlist.ts'
import { parseYahoo } from '../../../app/src/lib/prices.ts'
import { sendPush } from '../../../app/src/lib/webpush.ts'

const ALERTS_CRON = '*/15 * * * *'
const APP_URL = 'https://andreakampa.github.io/portafoglio/v2/'

const IBKR = 'https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService'
const RETRIABLE = new Set(['1001', '1004', '1005', '1019', '1021'])
const sleep = ms => new Promise(r => setTimeout(r, ms))
const tag = (xml, name) => (new RegExp(`<${name}>([^<]*)</${name}>`).exec(xml)?.[1] ?? '').trim()

// ── IBKR ──────────────────────────────────────────────────────────────────────
async function downloadFlex(token, queryId) {
  const call = async (path, q) =>
    (await fetch(`${IBKR}/${path}?${new URLSearchParams({ t: token, q, v: '3' })}`, {
      headers: { 'User-Agent': 'portafoglio-sync/1.0' },
      signal: AbortSignal.timeout(25000),
    })).text()
  const sent = await call('SendRequest', queryId)
  if (tag(sent, 'Status') !== 'Success') throw new Error(`IBKR SendRequest: ${tag(sent, 'ErrorCode')} ${tag(sent, 'ErrorMessage')}`)
  const ref = tag(sent, 'ReferenceCode')
  await sleep(5000)
  for (let i = 0; i < 12; i++) {
    const text = await call('GetStatement', ref)
    if (text.includes('<FlexQueryResponse')) return text
    const code = tag(text, 'ErrorCode')
    if (!RETRIABLE.has(code)) throw new Error(`IBKR GetStatement: ${code} ${tag(text, 'ErrorMessage')}`)
    await sleep(10000)
  }
  throw new Error('IBKR non ha preparato il report in tempo')
}

// ── Firebase (REST con token OAuth dell'account di servizio) ──────────────────
const b64url = buf =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const b64urlJson = obj => b64url(new TextEncoder().encode(JSON.stringify(obj)))

async function accessToken(sa) {
  const now = Math.floor(Date.now() / 1000)
  const claims = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email',
    aud: sa.token_uri,
    iat: now,
    exp: now + 3600,
  }
  const unsigned = `${b64urlJson({ alg: 'RS256', typ: 'JWT' })}.${b64urlJson(claims)}`
  const pem = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')
  const der = Uint8Array.from(atob(pem), c => c.charCodeAt(0))
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned))
  const r = await fetch(sa.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${b64url(sig)}` }),
  })
  const j = await r.json()
  if (!j.access_token) throw new Error(`Token Google non ottenuto: ${j.error ?? r.status}`)
  return j.access_token
}

function database(env, token) {
  const base = env.DB_URL.replace(/\/+$/, '')
  const ns = env.DB_NS ? `?ns=${env.DB_NS}` : '' // solo per gli emulatori
  const auth = env.EMULATOR === '1' ? { Authorization: 'Bearer owner' } : { Authorization: `Bearer ${token}` }
  return {
    // Lettura con ETag: la scrittura successiva riesce solo se nel frattempo nessuno ha cambiato i dati.
    async getWithEtag(path) {
      const r = await fetch(`${base}/${path}.json${ns}`, { headers: { ...auth, 'X-Firebase-ETag': 'true' } })
      if (!r.ok) throw new Error(`Lettura ${path}: HTTP ${r.status}`)
      return { etag: r.headers.get('ETag'), data: await r.json() }
    },
    async putIfMatch(path, data, etag) {
      const r = await fetch(`${base}/${path}.json${ns}`, {
        method: 'PUT',
        headers: { ...auth, 'Content-Type': 'application/json', 'if-match': etag },
        body: JSON.stringify(data),
      })
      if (r.status === 412) return false
      if (!r.ok) throw new Error(`Scrittura ${path}: HTTP ${r.status}`)
      return true
    },
    async get(path, query = '') {
      const sep = ns ? '&' : '?'
      const r = await fetch(`${base}/${path}.json${ns}${query ? sep + query : ''}`, { headers: auth })
      if (!r.ok) throw new Error(`Lettura ${path}: HTTP ${r.status}`)
      return r.json()
    },
    async patch(path, data) {
      const r = await fetch(`${base}/${path}.json${ns}`, { method: 'PATCH', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
      if (!r.ok) throw new Error(`Scrittura ${path}: HTTP ${r.status}`)
    },
    async del(path) {
      const r = await fetch(`${base}/${path}.json${ns}`, { method: 'DELETE', headers: auth })
      if (!r.ok) throw new Error(`Cancellazione ${path}: HTTP ${r.status}`)
    },
    async put(path, data) {
      const r = await fetch(`${base}/${path}.json${ns}`, { method: 'PUT', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
      if (!r.ok) throw new Error(`Scrittura ${path}: HTTP ${r.status}`)
    },
  }
}

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10)

// ── Sincronizzazione ─────────────────────────────────────────────────────────
export async function sync(env, { xml } = {}) {
  const sa = env.EMULATOR === '1' ? null : JSON.parse(env.FIREBASE_SA)
  const db = database(env, sa ? await accessToken(sa) : null)
  const report = parseFlex(xml ?? (await downloadFlex(env.IBKR_TOKEN, env.IBKR_QUERY_ID)))
  const path = `users/${env.UID}/portfolio_state/portfolios/${env.PORTFOLIO_ID}`

  let result
  for (let attempt = 0; attempt < 3; attempt++) {
    const { etag, data } = await db.getWithEtag(path)
    if (!data) throw new Error('Portafoglio IBKR non trovato su Firebase')
    result = applyFlexOrders(data, report.orders, newId, report.cash, report.margin)
    if (!result.changed || env.DRY_RUN === '1') break
    if (await db.putIfMatch(path, result.portfolio, etag)) break
    result = null // qualcuno ha salvato nel frattempo: si rilegge e si riprova
  }
  if (!result) throw new Error('Il portafoglio cambiava continuamente durante la sincronizzazione')

  const summary = {
    lastRun: new Date().toISOString(),
    ok: true,
    dryRun: env.DRY_RUN === '1',
    reportFrom: report.from,
    reportTo: report.to,
    added: result.added,
    linked: result.linked,
    cashAdded: result.cashAdded,
    review: [...result.review, ...Object.entries(report.unknownCash).map(([t, k]) => `Movimento di cassa non gestito: ${t} (${k})`)],
    skipped: report.skipped.map(s => `${s.date} ${s.symbol} (${s.category})`),
  }
  if (env.DRY_RUN !== '1') await db.put(`users/${env.UID}/ibkr_sync`, summary)
  return summary
}

// ── Avvisi di prezzo ─────────────────────────────────────────────────────────
async function quote(symbol) {
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (portafoglio-alerts)' },
  })
  if (!r.ok) return undefined
  return parseYahoo(await r.json())?.price
}

/** Controlla le soglie di tutte le watchlist e manda una notifica per ogni soglia raggiunta. */
export async function runAlerts(env) {
  const sa = env.EMULATOR === '1' ? null : JSON.parse(env.FIREBASE_SA)
  const db = database(env, sa ? await accessToken(sa) : null)
  const vapid = { publicKey: env.VAPID_PUBLIC, privateKey: env.VAPID_PRIVATE, subject: 'https://andreakampa.github.io/portafoglio/' }
  const users = Object.keys((await db.get('users', 'shallow=true')) ?? {})
  const report = { users: 0, checked: 0, hits: [], sent: 0, removed: 0 }
  for (const uid of users) {
    const raw = (await db.get(`users/${uid}/settings/watchlist`)) ?? {}
    const items = Object.entries(raw).map(([id, it]) => ({ ...it, id })).filter(it => it.symbol && (it.above != null || it.below != null))
    if (!items.length) continue
    report.users++
    const prices = {}
    for (const sym of new Set(items.map(i => i.symbol))) prices[sym] = await quote(sym).catch(() => undefined)
    report.checked += Object.keys(prices).length
    const { hits, fired } = checkAlerts(items, prices)
    if (Object.keys(fired).length) await db.patch(`users/${uid}/settings/watchlist`, Object.fromEntries(Object.entries(fired).map(([id, f]) => [`${id}/fired`, f])))
    if (!hits.length) continue
    report.hits.push(...hits.map(h => `${h.symbol} ${h.kind}`))
    const subs = Object.entries((await db.get(`users/${uid}/settings/push`)) ?? {})
    for (const h of hits) {
      for (const [sid, sub] of subs) {
        if (!sub?.endpoint || !vapid.privateKey) continue
        const status = await sendPush(sub, { title: 'Avviso di prezzo', body: alertText(h), tag: `alert-${h.id}-${h.kind}`, url: `${APP_URL}#/watchlist` }, vapid).catch(() => 0)
        if (status === 404 || status === 410) {
          await db.del(`users/${uid}/settings/push/${sid}`)
          report.removed++
        } else if (status >= 200 && status < 300) report.sent++
      }
    }
  }
  return report
}

export default {
  async scheduled(event, env, ctx) {
    if (event.cron === ALERTS_CRON) {
      ctx.waitUntil(runAlerts(env).then(r => console.log(JSON.stringify(r))).catch(e => console.error('Avvisi falliti:', e.message)))
      return
    }
    ctx.waitUntil(
      sync(env)
        .then(s => console.log(JSON.stringify(s)))
        .catch(async e => {
          console.error('Sincronizzazione fallita:', e.message)
          // Si registra l'errore, così l'app può mostrarlo.
          try {
            if (env.DRY_RUN === '1') return
            const sa = env.EMULATOR === '1' ? null : JSON.parse(env.FIREBASE_SA)
            await database(env, sa ? await accessToken(sa) : null).put(`users/${env.UID}/ibkr_sync/lastError`, { at: new Date().toISOString(), message: String(e.message).slice(0, 300) })
          } catch {
            /* niente da fare */
          }
        }),
    )
  },
  // Nessun accesso dall'esterno.
  async fetch() {
    return new Response('Not found', { status: 404 })
  },
}
