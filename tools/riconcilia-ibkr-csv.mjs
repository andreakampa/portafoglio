// Riconcilia i movimenti IBKR del sito con il rendiconto attività di IBKR (CSV, in italiano).
// Uso: node tools/riconcilia-ibkr-csv.mjs <rendiconto.csv>
// Confronta, per titolo e giorno, quantità e prezzo medio di acquisti, vendite, short e ricoperture.
// Non modifica nulla: stampa le differenze e le salva in .backup/riconciliazione-ibkr.md.

import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const DIR = path.join(ROOT, '.backup')
const csvFile = process.argv[2]
if (!csvFile) throw new Error('Indica il file CSV del rendiconto IBKR')

// CSV con campi tra virgolette (es. "2026-08-28, 11:19:26" o "1,515").
function parseLine(line) {
  const out = []
  let cur = '', q = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++ }
      else if (ch === '"') q = false
      else cur += ch
    } else if (ch === '"') q = true
    else if (ch === ',') { out.push(cur); cur = '' }
    else cur += ch
  }
  out.push(cur)
  return out
}
const num = s => parseFloat(String(s).replace(/,/g, '')) || 0
const rows = fs.readFileSync(csvFile, 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter(Boolean).map(parseLine)

const isinOf = {}
for (const r of rows) if (r[0] === 'Informazioni sullo strumento finanziario' && r[1] === 'Data') isinOf[r[3]] = r[6]

// Operazioni su azioni: segno della quantità + codice apertura/chiusura → tipo di movimento.
const ib = []
for (const r of rows) {
  if (r[0] !== 'Dettaglio eseguiti' || r[1] !== 'Data' || r[2] !== 'Order' || r[3] !== 'Azioni') continue
  const [, , , , currency, symbol, dt, qty, price, , , comm, , realized, , code] = r
  const q = num(qty)
  const codes = code.split(';')
  const opening = codes.includes('O')
  const type = q > 0 ? (opening ? 'buy' : 'buy_to_cover') : opening ? 'short_sell' : 'sell'
  ib.push({ symbol, isin: isinOf[symbol], currency, date: dt.slice(0, 10), type, qty: Math.abs(q), price: num(price), commission: Math.abs(num(comm)), realized: num(realized), mixed: codes.includes('O') && codes.includes('C') })
}

const backup = path.join(DIR, fs.readdirSync(DIR).filter(f => f.startsWith('database-')).sort().at(-1))
const user = Object.values(JSON.parse(fs.readFileSync(backup, 'utf8')).users)[0]
const pf = user.portfolio_state.portfolios[user.ibkr_config.portfolioId]
const assets = Object.entries(pf.assets)

const base = t => (t || '').split('.')[0].toUpperCase()
const assetFor = (symbol, isin) =>
  assets.find(([, a]) => isin && a.isin === isin) ??
  assets.find(([, a]) => base(a.ticker || a.nome) === symbol.replace(/[a-z]$/, '').toUpperCase()) ??
  assets.find(([, a]) => base(a.ticker || a.nome) === symbol.toUpperCase())

const year = ib[0]?.date.slice(0, 4) ?? '2026'
const key = (sym, date, type) => `${sym}|${date}|${type}`
const agg = new Map()
const add = (k, side, qty, price, extra = {}) => {
  const e = agg.get(k) ?? { ib: { qty: 0, value: 0 }, site: { qty: 0, value: 0 }, ...extra }
  e[side].qty += qty
  e[side].value += qty * price
  agg.set(k, e)
}

const unmatched = []
for (const t of ib) {
  const hit = assetFor(t.symbol, t.isin)
  if (!hit) { unmatched.push(t); continue }
  add(key(hit[1].ticker || hit[1].nome, t.date, t.type), 'ib', t.qty, t.price, { assetId: hit[0] })
}
for (const [id, a] of assets)
  for (const t of a.transactions ?? [])
    if (t.date?.startsWith(year) && ['buy', 'sell', 'short_sell', 'buy_to_cover'].includes(t.type))
      add(key(a.ticker || a.nome, t.date, t.type), 'site', +t.qty, +t.price, { assetId: id })

const out = []
const log = s => out.push(s)
log(`# Riconciliazione IBKR ${year} — rendiconto ${path.basename(csvFile)}\n`)
log(`Operazioni su azioni nel rendiconto: ${ib.length}. Confronto per titolo, giorno e tipo (quantità e prezzo medio).\n`)
const diffs = []
for (const [k, e] of [...agg].sort()) {
  const [sym, date, type] = k.split('|')
  const pIb = e.ib.qty ? e.ib.value / e.ib.qty : 0
  const pSite = e.site.qty ? e.site.value / e.site.qty : 0
  if (Math.abs(e.ib.qty - e.site.qty) > 1e-6 || Math.abs(pIb - pSite) > 0.005) diffs.push({ sym, date, type, e, pIb, pSite })
}
log(`## Differenze (${diffs.length})\n`)
log(`| Titolo | Data | Tipo | IBKR q.tà @ prezzo | Sito q.tà @ prezzo |`)
log(`|---|---|---|---|---|`)
for (const d of diffs) log(`| ${d.sym} | ${d.date} | ${d.type} | ${d.e.ib.qty ? `${d.e.ib.qty} @ ${+d.pIb.toFixed(4)}` : '—'} | ${d.e.site.qty ? `${d.e.site.qty} @ ${+d.pSite.toFixed(4)}` : '—'} |`)
if (unmatched.length) {
  log(`\n## Titoli del rendiconto non trovati nel sito\n`)
  for (const t of unmatched) log(`- ${t.date} ${t.symbol} ${t.type} ${t.qty} @ ${t.price}`)
}
const mixed = ib.filter(t => t.mixed)
if (mixed.length) log(`\nAttenzione: ${mixed.length} esecuzioni sia di apertura che di chiusura (codice O;C), da verificare a mano.`)

fs.writeFileSync(path.join(DIR, 'riconciliazione-ibkr.md'), out.join('\n'))
fs.writeFileSync(path.join(DIR, 'ibkr-trades.json'), JSON.stringify(ib, null, 1))
console.log(out.join('\n'))
