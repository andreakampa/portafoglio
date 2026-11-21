// Correzioni ai movimenti IBKR 2026 emerse dal rendiconto attività di IBKR (19/11/2026).
// Uso: node tools/correzioni-ibkr-2026.mjs <database.json> [--patch out.json]
// Senza --patch mostra solo cosa cambierebbe. Con --patch scrive un aggiornamento multi-percorso
// da applicare con:  firebase database:update /users/<uid>/portfolio_state/portfolios/<id> out.json

import fs from 'node:fs'
import path from 'node:path'

const [dbFile, flag, patchFile] = process.argv.slice(2)
const user = Object.values(JSON.parse(fs.readFileSync(dbFile, 'utf8')).users)[0]
const portfolios = user.portfolio_state.portfolios
const ibId = user.ibkr_config.portfolioId
const ib = portfolios[ibId]
const medId = Object.keys(portfolios).find(id => portfolios[id].name === 'Mediolanum')
const fxCache = JSON.parse(fs.readFileSync(path.join(path.dirname(dbFile), 'fx-cache.json'), 'utf8'))
const usdOn = date => {
  let d = new Date(date + 'T12:00:00Z')
  for (let i = 0; i < 8; i++) {
    const r = fxCache[d.toISOString().slice(0, 10)]
    if (r?.USD) return r.USD
    d = new Date(d - 864e5)
  }
  throw new Error('Cambio mancante per ' + date)
}
const newId = () => 'xm' + Math.random().toString(36).slice(2, 15)

const patch = {}
const changes = []
const assetOf = t => Object.entries(ib.assets).find(([, a]) => (a.ticker || a.nome) === t)
function edit(ticker, match, fields, why) {
  const [aid, a] = assetOf(ticker) ?? []
  if (!a) throw new Error(`${ticker} non trovato`)
  const idx = a.transactions.findIndex(match)
  if (idx < 0) throw new Error(`${ticker}: movimento da correggere non trovato (${why})`)
  const before = a.transactions[idx]
  for (const [k, v] of Object.entries(fields)) patch[`assets/${aid}/transactions/${idx}/${k}`] = v
  changes.push(`${ticker} ${before.date} ${before.type} ${before.qty}@${before.price} → ${JSON.stringify(fields)}  (${why})`)
}
function append(ticker, txs, why) {
  const [aid, a] = assetOf(ticker) ?? []
  if (!a) throw new Error(`${ticker} non trovato`)
  txs.forEach((t, i) => (patch[`assets/${aid}/transactions/${a.transactions.length + i}`] = t))
  changes.push(`${ticker}: aggiunti ${txs.map(t => `${t.date} ${t.type} ${t.qty}@${t.price}`).join(', ')}  (${why})`)
}
function newAsset(ticker, txs, why) {
  if (assetOf(ticker)) throw new Error(`${ticker} esiste già: niente da creare`)
  const aid = 'ID' + Date.now() + Math.floor(Math.random() * 1000)
  patch[`assets/${aid}`] = { nome: ticker, ticker, valuta: 'USD', tipoAsset: 'stock', commDefault: 0, isin: '', transactions: txs }
  changes.push(`${ticker}: nuovo titolo con ${txs.map(t => `${t.date} ${t.type} ${t.qty}@${t.price}`).join(', ')}  (${why})`)
}
const usdTx = (date, type, qty, price, commission, extra = {}) => ({ id: newId(), date, type, qty, price, commission, commissionCurrency: 'USD', exchangeRate: usdOn(date), ...extra })

edit('PNG.V', t => t.date === '2026-08-28' && t.type === 'buy' && t.price === 4.95, { price: 5.5 }, 'prezzo eseguito 5,50 CAD')
edit('INFQ', t => t.date === '2026-07-13' && t.type === 'buy' && t.price === 10.15, { price: 10.145 }, 'prezzo eseguito 10,145')
append('INFQ', [usdTx('2026-10-14', 'buy', 50, 9.585, 0.36040725)], 'acquisto mancante')
edit('NVDA', t => t.date === '2026-11-12' && t.type === 'buy_to_cover', { type: 'short_sell' }, 'era una seconda apertura short')
edit('NVDA', t => t.date === '2026-11-16' && t.type === 'buy_to_cover', { qty: 15 }, 'ricoperti tutti i 15')
edit('NBIS', t => t.date === '2026-11-04' && t.type === 'buy' && t.qty === 20, { date: '2026-11-05' }, 'eseguito il 5/11')
edit('RDDT', t => t.date === '2026-11-04' && t.type === 'sell', { date: '2026-11-05' }, 'eseguito il 5/11')
const amdOut = Object.values(portfolios[medId].assets).find(a => a.nome === 'AMD').transactions.find(t => t.type === 'transfer' && t.destPortfolioId === ibId)
newAsset('AMD', [
  { id: newId(), date: amdOut.date, type: 'transfer', qty: amdOut.qty, price: amdOut.price, commission: 0, sourcePortfolioId: medId, transferId: amdOut.transferId },
  usdTx('2026-06-30', 'sell', 6, 579, 0.41640965),
], 'trasferimento da Mediolanum e vendita del 30/06 mancanti')
newAsset('ANT', [usdTx('2026-11-19', 'buy', 5, 110, 0.34477225), usdTx('2026-11-19', 'sell', 5, 101, 0.35517525)], 'operazioni del 19/11 mancanti')

console.log(`Portafoglio ${ib.name} (${ibId}) — ${changes.length} correzioni:\n`)
for (const c of changes) console.log('- ' + c)
if (flag === '--patch') {
  fs.writeFileSync(patchFile, JSON.stringify(patch, null, 1))
  console.log(`\nAggiornamento scritto in ${patchFile} (${Object.keys(patch).length} percorsi)`)
}
