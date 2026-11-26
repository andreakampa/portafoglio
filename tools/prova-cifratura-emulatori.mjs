// Prova completa della cifratura sugli emulatori (firebase emulators:start --only auth,database + npx vite in app/).
// Uso: node tools/prova-cifratura-emulatori.mjs <cartella per gli screenshot>. Cancella i dati degli emulatori, mai quelli veri.
import { chromium } from 'playwright'
const SP = process.argv[2], URL0 = 'http://127.0.0.1:5173/portafoglio/v2/'
const DB = 'http://127.0.0.1:9000', NS = 'calcolo-pmc-default-rtdb', AUTH = 'http://127.0.0.1:9099'
const own = (m, p, b, q = '') => fetch(`${DB}/${p}.json?ns=${NS}${q}`, { method: m, headers: { Authorization: 'Bearer owner' }, body: b === undefined ? undefined : JSON.stringify(b) }).then(r => r.json())
const idt = (path, body) => fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/${path}?key=x`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json())
const log = (...a) => console.log(...a)
let fails = 0
const check = (name, ok) => { log(ok ? '  ✔' : '  ✘', name); if (!ok) fails++ }

await fetch(`${AUTH}/emulator/v1/projects/calcolo-pmc/accounts`, { method: 'DELETE' })
await own('PUT', '', { invites: { 'TEST-CODE-0002': { createdBy: 'x' } } })
// admin
const adm = await idt('accounts:signUp', { email: 'admin@test.it', password: 'password123', returnSecureToken: true })
await own('PATCH', '', { [`admins/${adm.localId}`]: true, [`members/${adm.localId}`]: { email: 'admin@test.it', invite: 'ADMIN-BOOT' } })

const br = await chromium.launch()
async function fresh() { const ctx = await br.newContext({ viewport: { width: 1200, height: 900 } }); const p = await ctx.newPage(); p.on('pageerror', e => log('PAGEERR', e.message)); p.on('console', m => { if (m.type() === 'error') log('CONSOLE', m.text().slice(0, 200)) }); await p.goto(URL0); await p.evaluate(() => localStorage.setItem('ptpro_emulator', '1')); await p.reload(); return { ctx, p } }

log('Amica invitata')
let { ctx, p } = await fresh()
await p.click('text=Ho un codice invito: registrati')
const pw1 = await p.$$('input[type=password]')
await p.fill('input[type=email]', 'anna@test.it'); await pw1[0].fill('password123'); await pw1[1].fill('password123'); await p.fill('input[placeholder="ABCD-EFGH-JKMN"]', 'TEST-CODE-0002')
await p.click('button:has-text("Crea account")'); await p.waitForSelector('text=La tua chiave di recupero', { timeout: 20000 })
await p.check('input[type=checkbox]'); await p.click('button:has-text("Entra")'); await p.waitForSelector('h1:has-text("Panoramica")', { timeout: 20000 })
await p.fill('input[placeholder^="es. Fineco"]', 'Fineco Segreto'); await p.click('button:has-text("Crea portafoglio")'); await p.waitForTimeout(2500)
const anna = Object.keys(await own('GET', 'members')).find(u => u !== adm.localId)
// Scritture con le stesse funzioni dell'app
const result = await p.evaluate(async uid => {
  const v = await import('/portafoglio/v2/src/lib/vault.ts')
  const st = (await v.get(v.ref(null, `users/${uid}/portfolio_state`))).val()
  const pid = st.activePortfolioId
  const tx = await v.runTransaction(v.ref(null, `users/${uid}/portfolio_state/portfolios/${pid}/assets/zzqx`), cur => cur ?? { nome: 'Zeta Quux Corp', ticker: 'ZZQX', valuta: 'USD', tipoAsset: 'stock', transactions: [{ id: 't1', date: '2026-11-20', type: 'buy', qty: 7, price: 123.45, commission: 1 }] })
  await v.push(v.ref(null, `users/${uid}/notes`), { text: 'nota molto riservata', createdAt: 1 })
  await v.set(v.ref(null, `users/${uid}/settings/maxLeverage`), 1.75)
  await v.update(v.ref(null, `users/${uid}/settings/watchlist`), { zzqx: { symbol: 'ZZQX', above: 999 } })
  await v.update(v.ref(null, `users/${uid}/portfolio_state/portfolios`), { [`${pid}/assets/zzqx/isin`]: 'US0000ZZQX01' })
  const back = (await v.get(v.ref(null, `users/${uid}/portfolio_state/portfolios/${pid}/assets/zzqx`))).val()
  const lev = (await v.get(v.ref(null, `users/${uid}/settings/maxLeverage`))).val()
  return { pid, committed: tx.committed, back, lev }
}, anna)
check('transazione riuscita', result.committed)
check('rilettura decifrata', result.back?.ticker === 'ZZQX' && result.back?.isin === 'US0000ZZQX01' && result.back.transactions[0].qty === 7)
check('impostazione riletta', result.lev === 1.75)
const raw = JSON.stringify(await own('GET', `users/${anna}`))
for (const s of ['Fineco Segreto', 'ZZQX', 'Zeta Quux', '123.45', 'riservata', '1.75', 'US0000ZZQX01']) check(`su Firebase non c'è "${s}" ${s === 'ZZQX' ? '(fuori dalla watchlist)' : ''}`, s === 'ZZQX' ? (raw.match(/ZZQX/g) ?? []).length === 1 && raw.includes('"watchlist":{"zzqx":{"above":999,"symbol":"ZZQX"}}') : !raw.includes(s))
check('watchlist in chiaro per le notifiche', raw.includes('"symbol":"ZZQX"'))
await p.reload(); await p.waitForSelector('h1:has-text("Panoramica")', { timeout: 20000 }); await p.waitForTimeout(2000)
await p.goto(URL0 + '#/movimenti'); await p.waitForTimeout(3000)
check('dopo ricarica i Movimenti mostrano il titolo', /Zeta Quux|ZZQX/.test(await p.textContent('body')))
await p.screenshot({ path: `${SP}/vault-movimenti.png` })
await p.goto(URL0 + '#/impostazioni'); await p.waitForTimeout(2000)
check('Impostazioni mostra il nome del portafoglio', (await p.textContent('body')).includes('Fineco Segreto'))
// Export decifrato
const exp = await p.evaluate(async uid => { const m = await import('/portafoglio/v2/src/lib/vault.ts'); return JSON.stringify((await m.get(m.ref(null, `users/${uid}`))).val()) }, anna)
check('lettura completa (export) decifrata', exp.includes('Fineco Segreto') && exp.includes('nota molto riservata'))
await ctx.close()

log('Amministratore (in chiaro)')
;({ ctx, p } = await fresh())
await p.fill('input[type=email]', 'admin@test.it'); await p.fill('input[type=password]', 'password123'); await p.click('button:has-text("Accedi")')
await p.waitForSelector('h1:has-text("Panoramica")', { timeout: 20000 })
await p.fill('input[placeholder^="es. Fineco"]', 'Portafoglio Admin'); await p.click('button:has-text("Crea portafoglio")'); await p.waitForTimeout(2500)
check('i dati dell\'admin restano in chiaro', JSON.stringify(await own('GET', `users/${adm.localId}`)).includes('Portafoglio Admin'))
check('nessuna busta per l\'admin', (await own('GET', `users/${adm.localId}/crypto`)) === null)
await br.close()
log(fails ? `${fails} FALLITI` : 'tutto ok')
