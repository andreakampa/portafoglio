// Sistemazione dei PAC di Trade Republic (21/11/2026), dagli screenshot dell'app e dalla fattura del 16/11.
// Uso: node tools/pac-trade-republic-2026.mjs <database.json> [--patch out.json]
// Senza --patch mostra solo cosa cambierebbe. Con --patch scrive un aggiornamento multi-percorso da applicare con:
//   firebase database:update /users/<uid>/portfolio_state/portfolios/<id> out.json
// Prezzi delle rate nuove: chiusura Yahoo del giorno (MCHT.MI, VALL.AS), segnate `priceEstimated: true`.

import fs from 'node:fs'

const [dbFile, flag, patchFile] = process.argv.slice(2)
const user = Object.values(JSON.parse(fs.readFileSync(dbFile, 'utf8')).users)[0]
const portfolios = user.portfolio_state.portfolios
const trId = Object.keys(portfolios).find(id => portfolios[id].name === 'Trade Republic')
const tr = portfolios[trId]
const newId = () => 'xm' + Math.random().toString(36).slice(2, 15)
const round = (n, d) => Math.round(n * 10 ** d) / 10 ** d

const patch = {}
const changes = []

// 1. MCHT.MI: ETF, e date di esecuzione di Trade Republic al posto dei lunedì.
const [mchtKey, mcht] = Object.entries(tr.assets).find(([, a]) => (a.ticker || a.nome) === 'MCHT.MI')
if (mcht.tipoAsset !== 'etf') {
  patch[`assets/${mchtKey}/tipoAsset`] = 'etf'
  changes.push(`MCHT.MI: tipo ${mcht.tipoAsset} -> etf`)
}
const moves = {
  '2026-06-01': '2026-06-02', '2026-06-08': '2026-06-09', '2026-06-15': '2026-06-16', '2026-06-22': '2026-06-23',
  '2026-06-29': '2026-07-02', '2026-07-06': '2026-07-09', '2026-07-13': '2026-07-16', '2026-07-20': '2026-07-23',
  '2026-07-27': '2026-08-03', '2026-08-03': '2026-08-10',
}
const txs = mcht.transactions
txs.forEach((t, i) => {
  if (t.source === 'pac' && moves[t.date]) {
    patch[`assets/${mchtKey}/transactions/${i}/date`] = moves[t.date]
    changes.push(`MCHT.MI rata ${i}: ${t.date} -> ${moves[t.date]}`)
  }
})
if (txs.length !== 14) throw new Error(`Attese 14 operazioni su MCHT.MI, trovate ${txs.length}: dati cambiati, rivedere lo script`)

// 2. Rate mancanti (prezzo = chiusura Yahoo).
const rata = (date, importo, price, extra = {}) => ({
  id: newId(), date, type: 'buy', qty: round(importo / price, 6), price, commission: 0, importoPac: importo, source: 'pac', ...extra,
})
const mchtNew = [
  ['2026-08-17', 30, 27.135], ['2026-08-24', 30, 26.025], ['2026-09-02', 30, 25.62], ['2026-09-16', 25, 24.865],
  ['2026-10-02', 25, 24.135], ['2026-10-16', 25, 23.555], ['2026-11-02', 25, 22.475], ['2026-11-16', 25, 22.205],
].map(([d, i, p]) => rata(d, i, p, { priceEstimated: true }))
mchtNew.forEach((t, k) => {
  patch[`assets/${mchtKey}/transactions/${txs.length + k}`] = t
  changes.push(`MCHT.MI nuova rata ${t.date}: ${t.importoPac} € a ${t.price} = ${t.qty} quote (stima)`)
})

// 3. Nuovo titolo FTSE Global All-Cap (PAC da 50 €), con la rata del 16/11 coi dati veri della fattura.
const ftseOld = Object.entries(tr.assets).find(([, a]) => a.isin === 'IE000VAHT5T0' || a.ticker === 'VALL.AS')
if (ftseOld) throw new Error('Il FTSE è già nel portafoglio: niente da aggiungere')
const ftseTxs = [
  rata('2026-09-16', 50, 4.291, { priceEstimated: true }),
  rata('2026-10-02', 50, 4.4065, { priceEstimated: true }),
  rata('2026-10-16', 50, 4.3865, { priceEstimated: true }),
  rata('2026-11-02', 50, 4.3695, { priceEstimated: true }),
  { id: newId(), date: '2026-11-16', type: 'buy', qty: 11.395491, price: 4.3877, commission: 0, importoPac: 50, source: 'pac' },
]
patch[`assets/ID${Date.now()}`] = {
  nome: 'Vanguard FTSE Global All-Cap USD (Acc)', ticker: 'VALL.AS', isin: 'IE000VAHT5T0', valuta: 'EUR', tipoAsset: 'etf', transactions: ftseTxs,
}
ftseTxs.forEach(t => changes.push(`FTSE nuova rata ${t.date}: ${t.importoPac} € a ${t.price} = ${t.qty} quote${t.priceEstimated ? ' (stima)' : ' (dati veri)'}`))

const speso = list => list.reduce((s, t) => s + t.qty * t.price, 0)
console.log(`Portafoglio: Trade Republic (${trId})`)
console.log(changes.join('\n'))
console.log(`\nMCHT.MI speso: ${speso(txs).toFixed(2)} € prima -> ${(speso(txs) + speso(mchtNew)).toFixed(2)} € dopo`)
console.log(`FTSE speso: ${speso(ftseTxs).toFixed(2)} €`)
if (flag === '--patch') {
  fs.writeFileSync(patchFile, JSON.stringify(patch, null, 1))
  const uid = Object.keys(JSON.parse(fs.readFileSync(dbFile, 'utf8')).users)[0]
  console.log(`\nPatch scritto: ${patchFile}\nApplica con: firebase database:update /users/${uid}/portfolio_state/portfolios/${trId} ${patchFile}`)
}
