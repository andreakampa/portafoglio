// Prova a secco del recupero storico da IBKR: applica un report Flex (anche di un anno) al portafoglio IBKR
// dell'ultimo backup locale e dice cosa verrebbe aggiunto. Non scrive su Firebase.
// Uso: node --experimental-strip-types tools/storico-ibkr.mjs .backup/flex-2026-01-01_2026-11-19.xml [--salva]
//   --salva scrive il portafoglio risultante in .backup/portafoglio-ibkr-storico.json (per rivederlo prima di pubblicarlo).

import fs from 'node:fs'
import path from 'node:path'
import { parseFlex } from '../app/src/domain/ibkr/flex.ts'
import { applyFlexOrders } from '../app/src/domain/ibkr/sync.ts'

const ROOT = path.resolve(import.meta.dirname, '..')
const DIR = path.join(ROOT, '.backup')
const xmlFile = process.argv[2]
if (!xmlFile) throw new Error('Indica il file XML del report Flex')
const backup = path.join(DIR, fs.readdirSync(DIR).filter(f => f.startsWith('database-')).sort().at(-1))
const user = Object.values(JSON.parse(fs.readFileSync(backup, 'utf8')).users)[0]
const pid = user.ibkr_config?.portfolioId
const portfolio = user.portfolio_state.portfolios[pid]
if (!portfolio) throw new Error('Portafoglio IBKR non trovato nel backup')

const report = parseFlex(fs.readFileSync(xmlFile, 'utf8'))
let n = 0
const res = applyFlexOrders(portfolio, report.orders, () => 'T' + n++ + Date.now().toString(36), report.cash, report.margin)

console.log(`Report ${report.from} → ${report.to}: ${report.orders.length} ordini, ${report.cash.length} movimenti di cassa, ${report.margin.days.length} giorni di interessi a debito`)
console.log(`Nuovi movimenti: ${res.added.length} | collegati a manuali: ${res.linked.length} | da controllare: ${res.review.length} | cassa importata: ${res.cashAdded.length}`)
const days = res.portfolio.marginDaily ?? []
console.log(`Storico margine: ${days.length} giorni${days.length ? ` (${days[0].date} → ${days.at(-1).date})` : ''}`)
if (Object.keys(report.unknownCash).length) console.log('Cassa non gestita:', report.unknownCash)
for (const [t, list] of [['AGGIUNTI', res.added], ['COLLEGATI', res.linked], ['DA CONTROLLARE', res.review]]) {
  if (list.length) console.log(`\n${t}:\n  ` + list.slice(0, 40).join('\n  ') + (list.length > 40 ? `\n  … e altri ${list.length - 40}` : ''))
}
// Cosa cambia nei movimenti inseriti a mano che vengono collegati a IBKR (prezzo, commissioni, cambio).
const before = new Map()
for (const a of Object.values(portfolio.assets ?? {})) for (const t of a.transactions ?? []) before.set(t.id, t)
const diff = { prezzo: [], commissioni: [], cambio: [] }
for (const [aid, a] of Object.entries(res.portfolio.assets ?? {})) {
  for (const t of a.transactions ?? []) {
    const o = before.get(t.id)
    if (!o || !t.externalId || o.externalId) continue
    const sym = a.ticker || a.nome || aid
    const rel = (x, y) => Math.abs((Number(x) || 0) - (Number(y) || 0)) / (Math.abs(Number(y)) || 1)
    if (rel(t.price, o.price) > 1e-6) diff.prezzo.push(`${t.date} ${sym}: ${o.price} → ${+Number(t.price).toFixed(4)}`)
    if (Math.abs((Number(t.commission) || 0) - (Number(o.commission) || 0)) > 0.005) diff.commissioni.push(`${t.date} ${sym}: ${o.commission ?? 0} → ${+Number(t.commission).toFixed(4)}`)
    if ((o.exchangeRate ?? null) !== (t.exchangeRate ?? null) && rel(t.exchangeRate, o.exchangeRate) > 1e-4) diff.cambio.push(`${t.date} ${sym}: ${o.exchangeRate ?? '—'} → ${+Number(t.exchangeRate).toFixed(5)}`)
  }
}
console.log(`\nCambiamenti sui movimenti collegati: prezzo ${diff.prezzo.length}, commissioni ${diff.commissioni.length}, cambio ${diff.cambio.length}`)
for (const [k, list] of Object.entries(diff)) if (list.length) console.log(`  ${k} (primi 8):\n    ` + list.slice(0, 8).join('\n    '))

if (process.argv.includes('--salva')) {
  const out = path.join(DIR, 'portafoglio-ibkr-storico.json')
  fs.writeFileSync(out, JSON.stringify(res.portfolio))
  console.log(`\nSalvato: ${out}`)
}
