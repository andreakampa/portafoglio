// Confronto del costo fiscale dei titoli trasferiti tra portafogli: calcolo per portafoglio (prima)
// contro calcolo di tutti i portafogli insieme (dopo). Uso:  node tools/confronto-trasferimenti.mjs [backup.json]
// Non scrive su Firebase. Legge .backup/ (escluso da git) e i cambi già salvati in .backup/fx-cache.json
// (lanciare prima tools/confronto-motori.mjs per aggiornarli).

import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = path.resolve(import.meta.dirname, '..')
const BACKUP_DIR = path.join(ROOT, '.backup')
const backupFile = process.argv[2] ?? path.join(BACKUP_DIR, fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith('database-')).sort().at(-1))
const data = JSON.parse(fs.readFileSync(backupFile, 'utf8'))
const fxCache = JSON.parse(fs.readFileSync(path.join(BACKUP_DIR, 'fx-cache.json'), 'utf8'))

// Come il sito: se la data è festiva, giorno lavorativo precedente (fino a 7 giorni).
const fx = (cur, date) => {
  let d = new Date(date + 'T12:00:00Z')
  for (let i = 0; i < 8; i++) {
    const r = fxCache[d.toISOString().slice(0, 10)]?.[cur]
    if (r) return r
    d = new Date(d.getTime() - 86400000)
  }
  return undefined
}

const { computePortfolio, computeAllPortfolios } = await import(pathToFileURL(path.join(ROOT, 'app/src/domain/engine/portfolio.ts')).href)
const portfolios = Object.assign({}, ...Object.values(data.users ?? {}).map(u => u.portfolio_state?.portfolios ?? {}))
const after = computeAllPortfolios(portfolios, fx)
const eur = x => x.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })
const realized = r => Object.values(r.positions).reduce((sum, x) => sum + x.realizedEur, 0)

let out = `# Costo dei trasferimenti: prima e dopo\n\nBackup: ${path.basename(backupFile)}\n`
for (const [pid, p] of Object.entries(portfolios)) {
  const before = computePortfolio(p, fx)
  out += `\n## ${p.name} (${p.taxRegime})\n\n`
  out += `| Titolo | Quantità | Costo prima | Costo dopo | Differenza |\n|---|---:|---:|---:|---:|\n`
  let tb = 0
  let ta = 0
  for (const [aid, a] of Object.entries(p.assets ?? {})) {
    const b = before.positions[aid]
    const n = after[pid].positions[aid]
    tb += b.costEur
    ta += n.costEur
    const hasTransfer = (a.transactions ?? []).some(t => t.type === 'transfer')
    if (hasTransfer && (Math.abs(b.costEur - n.costEur) > 0.005 || n.issues.length)) {
      out += `| ${a.ticker || a.nome} | ${n.qty} | ${eur(b.costEur)} | ${eur(n.costEur)} | ${eur(n.costEur - b.costEur)} |\n`
    }
  }
  out += `\nCosto totale: prima ${eur(tb)}, dopo ${eur(ta)}. Plus/minus realizzate: prima ${eur(realized(before))}, dopo ${eur(realized(after[pid]))}.\n`
  const warn = after[pid].issues.filter(i => i.code === 'trasferimento-non-collegato' || i.code === 'cambio-mancante')
  if (warn.length) out += `\nAvvisi: ${warn.map(w => `${w.date} ${w.code}`).join('; ')}\n`
}
fs.writeFileSync(path.join(BACKUP_DIR, 'confronto-trasferimenti.md'), out)
console.log(out)
