// Import dell'esportazione delle transazioni di Trade Republic sui dati dell'ultimo backup locale, con lo stesso
// motore del tasto "Importa da Trade Republic" della v2. Di base è una prova a secco: dice cosa cambierebbe.
// Uso: node --experimental-strip-types tools/import-trade-republic.mjs .backup/transactions_….csv [--salva]
//   --salva scrive in .backup/tr-import/ un file per titolo da cambiare e stampa i comandi `firebase database:set`.

import fs from 'node:fs'
import path from 'node:path'
import { applyTrMatches, parseTrCsv, planTrImport, suggestIsinLinks, withIsins } from '../app/src/domain/tradeRepublic.ts'

const ROOT = path.resolve(import.meta.dirname, '..')
const DIR = path.join(ROOT, '.backup')
const csv = process.argv[2]
if (!csv) throw new Error('Indica il file CSV di Trade Republic')
const backup = path.join(DIR, fs.readdirSync(DIR).filter(f => f.startsWith('database-')).sort().at(-1))
const users = JSON.parse(fs.readFileSync(backup, 'utf8')).users
const trades = parseTrCsv(fs.readFileSync(csv, 'utf8'))
const isins = new Set(trades.map(t => t.isin))

// Il portafoglio giusto è quello con più titoli presenti nel file.
let best = null
for (const [uid, u] of Object.entries(users)) {
  for (const [pid, p] of Object.entries(u.portfolio_state?.portfolios ?? {})) {
    const hits = Object.values(p.assets ?? {}).filter(a => a?.isin && isins.has(a.isin.trim().toUpperCase())).length
    if (hits && (!best || hits > best.hits)) best = { uid, pid, p, hits }
  }
}
if (!best) throw new Error('Nessun portafoglio contiene i titoli del file')
const { uid, pid, p } = best
console.log(`Backup ${path.basename(backup)} · portafoglio "${p.name ?? pid}" · ${trades.length} operazioni nel file`)

// Titoli senza ISIN che corrispondono a un ISIN del file (stessa proposta del tasto nella v2).
const links = suggestIsinLinks(p.assets, trades)
for (const [isin, aid] of Object.entries(links)) console.log(`Collego ${isin} al titolo ${p.assets[aid]?.ticker || p.assets[aid]?.nome || aid} (${aid}), che non aveva l'ISIN`)
p.assets = withIsins(p.assets, links)
const plan = planTrImport(p.assets, trades)
const sym = id => p.assets[id]?.ticker || p.assets[id]?.nome || id
const fmt = (q, pr) => `${+Number(q).toFixed(6)} × ${+Number(pr).toFixed(4)}`
for (const action of ['replace', 'fix', 'new', 'same', 'unknown']) {
  const list = plan.matches.filter(m => m.action === action)
  if (!list.length) continue
  console.log(`\n${action.toUpperCase()} (${list.length}):`)
  for (const m of list) {
    const b = m.before ? `${m.before.date} ${fmt(m.before.qty, m.before.price)} → ` : ''
    console.log(`  ${m.trade.date} ${sym(m.assetId) || m.trade.name} ${m.trade.side}: ${b}${fmt(m.trade.qty, m.trade.price)}${m.trade.fee ? ` + ${m.trade.fee} comm.` : ''}`)
  }
}
if (plan.onlyInApp.length) console.log(`\nNell'app ma non nel file (non toccati):\n  ` + plan.onlyInApp.map(x => `${x.date} ${sym(x.assetId)} ${fmt(x.qty, x.price)}`).join('\n  '))

let n = 0
const newId = () => 'tr' + Date.now().toString(36) + (n++).toString(36)
const out = path.join(DIR, 'tr-import')
const todo = new Map()
for (const m of plan.matches) if (['replace', 'fix', 'new'].includes(m.action)) todo.set(m.assetId, [...(todo.get(m.assetId) ?? []), m])
for (const [aid, list] of todo) {
  const a = p.assets[aid]
  const next = applyTrMatches(a.transactions ?? [], list, newId)
  if (!next) throw new Error(`Movimenti di ${sym(aid)} cambiati: rifare il backup`)
  const qty = l => l.reduce((s, t) => s + (t.type === 'sell' ? -1 : 1) * (Number(t.qty) || 0), 0)
  console.log(`\n${sym(aid)}: movimenti ${a.transactions?.length ?? 0} → ${next.length}, quantità ${+qty(a.transactions ?? []).toFixed(6)} → ${+qty(next).toFixed(6)}`)
  if (process.argv.includes('--salva')) {
    fs.mkdirSync(out, { recursive: true })
    const file = path.join(out, `${aid}.json`)
    fs.writeFileSync(file, JSON.stringify(JSON.parse(JSON.stringify(next))))
    console.log(`  firebase database:set /users/${uid}/portfolio_state/portfolios/${pid}/assets/${aid}/transactions "${file}" -f`)
    const isin = Object.entries(links).find(([, v]) => v === aid)?.[0]
    if (isin) {
      const f2 = path.join(out, `${aid}-isin.json`)
      fs.writeFileSync(f2, JSON.stringify(isin))
      console.log(`  firebase database:set /users/${uid}/portfolio_state/portfolios/${pid}/assets/${aid}/isin "${f2}" -f`)
    }
  }
}
