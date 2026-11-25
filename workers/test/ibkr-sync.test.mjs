// ibkr-sync: con l'interruttore dell'app spento non scarica nulla da IBKR e segna la pausa.
// Si lancia con npm run test:workers (insieme agli altri test dei Worker).
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { runAlerts, sync } from '../ibkr-sync/src/worker.js'

const env = { EMULATOR: '1', DB_URL: 'http://db.test', UID: 'u1', PORTFOLIO_ID: 'P1', IBKR_TOKEN: 't', IBKR_QUERY_ID: 'q' }
const realFetch = globalThis.fetch

describe('ibkr-sync: interruttore "scarica ogni mattina"', () => {
  afterEach(() => { globalThis.fetch = realFetch })

  it('in pausa: nessuna chiamata a IBKR, scrive lo stato con portfolioId', async () => {
    const calls = []
    globalThis.fetch = async (url, init = {}) => {
      calls.push({ url: String(url), method: init.method ?? 'GET', body: init.body })
      if (String(url).includes('/settings/ibkrAutoSync.json')) return new Response('false')
      return new Response('null')
    }
    const r = await sync(env)
    assert.equal(r.paused, true)
    assert.equal(r.portfolioId, 'P1')
    assert.ok(!calls.some(c => c.url.includes('interactivebrokers')), 'non deve chiamare IBKR')
    const put = calls.find(c => c.method === 'PUT')
    assert.equal(put.url, 'http://db.test/users/u1/ibkr_sync.json')
    assert.equal(JSON.parse(put.body).paused, true)
  })

  it('attivo (valore assente): prova a scaricare da IBKR', async () => {
    const calls = []
    globalThis.fetch = async url => {
      calls.push(String(url))
      if (String(url).includes('interactivebrokers')) return new Response('<FlexStatementResponse><Status>Fail</Status><ErrorCode>1020</ErrorCode></FlexStatementResponse>')
      return new Response('null')
    }
    await assert.rejects(sync(env), /IBKR SendRequest/)
    assert.ok(calls.some(u => u.includes('interactivebrokers')))
  })
})

describe('ibkr-sync: avvisi di prezzo per tanti utenti', () => {
  afterEach(() => { globalThis.fetch = realFetch })

  // 30 utenti, ognuno con 5 titoli presi da 60 diversi: senza limiti sarebbero 150 richieste a Yahoo.
  const SYMS = Array.from({ length: 60 }, (_, i) => `S${String(i).padStart(2, '0')}`)
  const users = Object.fromEntries(Array.from({ length: 30 }, (_, u) => [`u${u}`, true]))
  const watchlist = u => Object.fromEntries(Array.from({ length: 5 }, (_, k) => {
    const sym = SYMS[(u * 7 + k * 11) % SYMS.length]
    return [sym.toLowerCase(), { symbol: sym, above: 1_000_000 }]
  }))

  function fakeFetch(db) {
    const calls = []
    globalThis.fetch = async (url, init = {}) => {
      const u = new URL(String(url))
      calls.push({ host: u.host, path: u.pathname, method: init.method ?? 'GET' })
      if (u.host.includes('yahoo')) {
        return new Response(JSON.stringify({ chart: { result: [{ meta: { regularMarketPrice: 10, currency: 'USD' }, indicators: { quote: [{ close: [10] }] } }] } }))
      }
      const p = decodeURIComponent(u.pathname).replace(/\.json$/, '').replace(/^\//, '')
      if (init.method === 'PUT') { db[p] = JSON.parse(init.body); return new Response(init.body) }
      if (p === 'users') return new Response(JSON.stringify(users))
      const m = p.match(/^users\/u(\d+)\/settings\/watchlist$/)
      if (m) return new Response(JSON.stringify(watchlist(Number(m[1]))))
      return new Response(JSON.stringify(db[p] ?? null))
    }
    return calls
  }

  it('resta entro 50 richieste e a turno controlla tutti i titoli', async () => {
    const db = {}
    const seen = new Set()
    for (let run = 0; run < 12; run++) { // 7 titoli a giro: 60 titoli in 9 giri (poco più di 2 ore)
      const calls = fakeFetch(db)
      const r = await runAlerts(env)
      assert.ok(calls.length <= 50, `giro ${run}: ${calls.length} richieste`)
      assert.equal(r.users, 30)
      calls.filter(c => c.host.includes('yahoo')).forEach(c => seen.add(c.path.split('/').pop()))
    }
    const all = new Set(Object.keys(users).flatMap((_, u) => Object.values(watchlist(u)).map(i => i.symbol)))
    assert.deepEqual([...all].filter(s => !seen.has(s)), [], 'ogni titolo controllato almeno una volta')
  })
})
