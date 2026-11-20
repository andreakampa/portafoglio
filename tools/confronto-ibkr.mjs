// Confronta il portafoglio IBKR calcolato dal nuovo motore con il report Flex di IBKR.
// Uso: node tools/scarica-flex.mjs && node tools/confronto-ibkr.mjs
// IBKR calcola con FIFO: per un confronto alla pari si usa anche il motore in FIFO.
// Il risultato fiscale italiano (dichiarativo) resta LIFO.

import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = path.resolve(import.meta.dirname, '..')
const DIR = path.join(ROOT, '.backup')
const latest = prefix => path.join(DIR, fs.readdirSync(DIR).filter(f => f.startsWith(prefix)).sort().at(-1))
const xml = fs.readFileSync(latest('flex-'), 'utf8')
const user = Object.values(JSON.parse(fs.readFileSync(latest('database-'), 'utf8')).users)[0]
const portfolio = user.portfolio_state.portfolios[user.ibkr_config.portfolioId]

const attrs = tag => [...xml.matchAll(new RegExp(`<${tag} ([^>]*)/?>`, 'g'))].map(m => Object.fromEntries([...m[1].matchAll(/(\w+)="([^"]*)"/g)].map(x => [x[1], x[2]])))
const ibPos = attrs('OpenPosition').filter(p => p.levelOfDetail === 'SUMMARY' && p.assetCategory === 'STK')
const ibYtd = attrs('MTDYTDPerformanceSummaryUnderlying').filter(p => p.assetCategory === 'STK')
const reportDate = attrs('FlexStatement')[0]?.toDate

// ── Cambi storici (stessa cache di confronto-motori) ──
const FX_FILE = path.join(DIR, 'fx-cache.json')
const fxCache = fs.existsSync(FX_FILE) ? JSON.parse(fs.readFileSync(FX_FILE, 'utf8')) : {}
async function day(date) {
  if (fxCache[date] !== undefined) return fxCache[date]
  const j = await (await fetch(`https://tassidicambio.bancaditalia.it/terzevalute-wf-web/rest/v1.0/dailyRates?lang=it&currencyIsoCode=EUR&referenceDate=${date}`, { headers: { Accept: 'application/json' } })).json()
  const out = Object.fromEntries((j.rates ?? []).map(r => [r.isoCode, parseFloat(r.avgRate)]))
  return (fxCache[date] = Object.keys(out).length ? out : null)
}
const HIST = {}
for (const a of Object.values(portfolio.assets)) for (const t of a.transactions ?? []) for (const cur of ['USD', 'CAD']) {
  let d = new Date(t.date + 'T12:00:00Z')
  for (let i = 0; i < 8; i++) {
    const r = await day(d.toISOString().slice(0, 10))
    if (r?.[cur]) { HIST[`${cur}|${t.date}`] = r[cur]; break }
    d = new Date(d - 86400000)
  }
}
fs.writeFileSync(FX_FILE, JSON.stringify(fxCache))
const fx = (cur, date) => HIST[`${cur}|${date}`]

const { computePosition } = await import(pathToFileURL(path.join(ROOT, 'app/src/domain/engine/positions.ts')))
const f = (n, d = 2) => (Number.isFinite(n) ? n.toLocaleString('it-IT', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—')
const year = reportDate?.slice(0, 4)
const out = []
const log = s => out.push(s)

log(`# Confronto con IBKR — report del ${reportDate}\n`)
log(`Portafoglio: ${portfolio.name}. IBKR: ${ibPos.length} posizioni aperte, ${ibYtd.length} titoli con risultati ${year}.\n`)

const key = a => a.isin || (a.ticker || a.nome || '').split('.')[0]
const ibKey = p => p.isin || p.symbol
const rows = []
const seen = new Set()
for (const [id, a] of Object.entries(portfolio.assets)) {
  const k = key(a)
  seen.add(k)
  const fifo = computePosition(a, 'fifo', fx)
  const lifo = computePosition(a, 'lifo', fx)
  const ip = ibPos.find(p => ibKey(p) === k || p.symbol === (a.ticker || a.nome || '').split('.')[0])
  const iy = ibYtd.find(p => ibKey(p) === k || p.symbol === (a.ticker || a.nome || '').split('.')[0])
  const sign = ip ? (ip.side === 'Short' ? -1 : 1) : 0
  const realizedYear = r => r.realized.filter(e => e.date.startsWith(year)).reduce((s, e) => s + e.gainEur, 0)
  rows.push({
    titolo: a.ticker || a.nome,
    qtaSito: fifo.qty,
    qtaIbkr: ip ? Math.abs(+ip.position) * sign : 0,
    costoFifo: Math.abs(fifo.costNative),
    costoIbkr: ip ? Math.abs(+ip.costBasisMoney) : 0,
    realFifo: realizedYear(fifo),
    realLifo: realizedYear(lifo),
    realIbkr: iy ? +iy.realizedPnlYTD : 0,
    valuta: a.valuta,
  })
}
const extra = ibPos.filter(p => !seen.has(ibKey(p)) && !rows.some(r => (r.titolo || '').split('.')[0] === p.symbol))

const qDiff = rows.filter(r => Math.abs(r.qtaSito - r.qtaIbkr) > 1e-6)
log(`## 1. Quantità\n`)
if (!qDiff.length && !extra.length) log('Tutte le quantità coincidono con IBKR.\n')
for (const r of qDiff) log(`- **${r.titolo}**: sito ${f(r.qtaSito, 4)}, IBKR ${f(r.qtaIbkr, 4)}`)
for (const p of extra) log(`- **${p.symbol}**: in IBKR (${p.position}) ma non nel sito`)

log(`\n## 2. Costo delle posizioni aperte (valuta del titolo, metodo FIFO come IBKR)\n`)
log(`| Titolo | Sito FIFO | IBKR | Differenza |`)
log(`|---|---|---|---|`)
let costOk = 0
for (const r of rows.filter(r => r.qtaIbkr !== 0)) {
  const d = r.costoFifo - r.costoIbkr
  if (Math.abs(d) < 0.05) { costOk++; continue }
  log(`| ${r.titolo} | ${f(r.costoFifo)} ${r.valuta} | ${f(r.costoIbkr)} | ${f(d)} |`)
}
log(`\n${costOk} posizioni coincidono al centesimo.\n`)

log(`## 3. Realizzato ${year} in EUR\n`)
log(`| Titolo | Sito FIFO | IBKR (FIFO) | Differenza | Sito LIFO (fiscale) |`)
log(`|---|---|---|---|---|`)
let tf = 0, ti = 0, tl = 0
for (const r of rows.filter(r => Math.abs(r.realIbkr) > 0.005 || Math.abs(r.realFifo) > 0.005)) {
  tf += r.realFifo; ti += r.realIbkr; tl += r.realLifo
  log(`| ${r.titolo} | ${f(r.realFifo)} | ${f(r.realIbkr)} | ${f(r.realFifo - r.realIbkr)} | ${f(r.realLifo)} |`)
}
log(`| **Totale** | **${f(tf)}** | **${f(ti)}** | **${f(tf - ti)}** | **${f(tl)}** |`)

fs.writeFileSync(path.join(DIR, 'confronto-ibkr.md'), out.join('\n'))
console.log(out.join('\n'))
