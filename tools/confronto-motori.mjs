// Confronto tra il motore di calcolo del sito attuale (js/) e il nuovo (app/src/domain/engine/)
// sui dati reali del backup. Uso:  node tools/confronto-motori.mjs [percorso-backup.json]
//
// Non scrive nulla su Firebase. Legge il backup in .backup/ (escluso da git, contiene dati
// personali) e salva il rapporto in .backup/confronto.md.
// I cambi storici arrivano dalla Banca d'Italia e restano in .backup/fx-cache.json.

import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = path.resolve(import.meta.dirname, '..')
const BACKUP_DIR = path.join(ROOT, '.backup')
const backupFile = process.argv[2] ?? path.join(BACKUP_DIR, fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith('database-')).sort().at(-1))
const data = JSON.parse(fs.readFileSync(backupFile, 'utf8'))

// ── Cambi storici (Banca d'Italia, unità di valuta per 1 EUR) ─────────────────
const FX_FILE = path.join(BACKUP_DIR, 'fx-cache.json')
const fxCache = fs.existsSync(FX_FILE) ? JSON.parse(fs.readFileSync(FX_FILE, 'utf8')) : {}

async function ratesOn(date) {
  if (fxCache[date] !== undefined) return fxCache[date]
  const url = `https://tassidicambio.bancaditalia.it/terzevalute-wf-web/rest/v1.0/dailyRates?lang=it&currencyIsoCode=EUR&referenceDate=${date}`
  const j = await (await fetch(url, { headers: { Accept: 'application/json' } })).json()
  const out = {}
  for (const r of j.rates ?? []) out[r.isoCode] = parseFloat(r.avgRate)
  fxCache[date] = Object.keys(out).length ? out : null
  return fxCache[date]
}

// Come il sito: se la data è festiva, si usa il giorno lavorativo precedente (fino a 7 giorni).
async function histRate(cur, date) {
  let d = new Date(date + 'T12:00:00Z')
  for (let i = 0; i < 8; i++) {
    const r = await ratesOn(d.toISOString().slice(0, 10))
    if (r?.[cur]) return r[cur]
    d = new Date(d.getTime() - 86400000)
  }
  return undefined
}

const users = Object.values(data.users ?? {})
const portfolios = users.flatMap(u => Object.values(u.portfolio_state?.portfolios ?? {}))
const needed = new Set()
for (const p of portfolios)
  for (const a of Object.values(p.assets ?? {}))
    for (const t of a.transactions ?? []) for (const cur of ['USD', 'CAD']) needed.add(`${cur}|${t.date}`)
const HIST = {}
for (const k of needed) {
  const [cur, date] = k.split('|')
  HIST[k] = await histRate(cur, date)
}
const today = new Date().toISOString().slice(0, 10)
const CURRENT = { USD: await histRate('USD', today), CAD: await histRate('CAD', today) }
fs.writeFileSync(FX_FILE, JSON.stringify(fxCache))
const fx = (cur, date) => HIST[`${cur}|${date}`]

// ── Vecchio motore, con lo stesso comportamento che ha nel browser ────────────
const store = new Map()
globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) }
globalThis.window = globalThis
const { Exchange } = await import(pathToFileURL(path.join(ROOT, 'js/api/exchange.js')))
const { Calc } = await import(pathToFileURL(path.join(ROOT, 'js/modules/portfolio/calc.js')))
const { calcolaCompensazione } = await import(pathToFileURL(path.join(ROOT, 'js/api/fiscale.js')))
Exchange.rate = CURRENT.USD
Exchange.rates = { ...CURRENT }
// Nel browser i cambi storici finiscono in _memoryCache con chiave "USD_data", ma calc.js li
// cerca con la sola data: qui si riproduce esattamente quel comportamento.
for (const [k, v] of Object.entries(HIST)) if (v) Exchange._memoryCache.set(k.replace('|', '_'), { rate: v, ts: Date.now() })
Exchange.getRateForDate = async (date, cur = 'USD') => HIST[`${cur}|${date}`] ?? Exchange.rates[cur]

// ── Nuovo motore ───────────────────────────────────────────────────────────────
const { computePortfolio } = await import(pathToFileURL(path.join(ROOT, 'app/src/domain/engine/portfolio.ts')))

const f = (n, d = 2) => (Number.isFinite(n) ? n.toLocaleString('it-IT', { minimumFractionDigits: d, maximumFractionDigits: d }) : String(n))
const diff = (a, b, tol = 0.01) => !(Math.abs((a ?? 0) - (b ?? 0)) <= tol)
const out = []
const log = s => out.push(s)

log(`# Confronto motori — ${today}\n`)
log(`Cambio "di oggi" usato dal vecchio motore quando non trova lo storico: USD ${CURRENT.USD}, CAD ${CURRENT.CAD}\n`)

for (const p of portfolios) {
  const regime = p.taxRegime === 'dichiarativo' ? 'dichiarativo' : 'amministrato'
  Calc.clearCaches()
  const nuovo = computePortfolio(p, fx)
  log(`\n## ${p.name} (${regime})\n`)

  if (nuovo.issues.length) {
    log(`### Problemi nei dati segnalati dal nuovo motore\n`)
    for (const i of nuovo.issues) log(`- ${p.assets[i.assetId]?.ticker || p.assets[i.assetId]?.nome}: ${i.message}`)
    log('')
  }

  log(`### Posizioni (solo differenze > 0,01)\n`)
  log(`| Titolo | Qtà vecchio | Qtà nuovo | PMC € vecchio | PMC € nuovo | Realizzato € vecchio | Realizzato € nuovo |`)
  log(`|---|---|---|---|---|---|---|`)
  let posDiff = 0
  for (const [id, a] of Object.entries(p.assets ?? {})) {
    const vecchio = await Calc.position(a, regime) // è quello che mostra la tabella del sito
    const n = nuovo.positions[id]
    if (diff(vecchio.qta, n.qty, 1e-6) || diff(vecchio.pmcEur, n.pmcEur) || diff(vecchio.realizedPnL, n.realizedEur)) {
      posDiff++
      log(`| ${a.ticker || a.nome} | ${f(vecchio.qta, 4)} | ${f(n.qty, 4)} | ${f(vecchio.pmcEur)} | ${f(n.pmcEur)} | ${f(vecchio.realizedPnL)} | ${f(n.realizedEur)} |`)
    }
  }
  if (!posDiff) log(`| nessuna differenza | | | | | | |`)

  log(`\n### Cassetto fiscale per anno\n`)
  const old = calcolaCompensazione(p, regime)
  const years = new Set([...old.dettaglioPlus.map(x => x.anno), ...nuovo.fiscal.lines.map(l => l.year)])
  log(`| Anno | Plus vecchio | Plus nuovo | Minus vecchio | Minus nuovo | Tassabile vecchio | Tassabile nuovo |`)
  log(`|---|---|---|---|---|---|---|`)
  const oldMinusByYear = {}
  for (const [id, a] of Object.entries(p.assets ?? {}))
    for (const ev of Calc.realizedEvents(a, regime)) if (ev.pnlEur < -0.01) {
      const y = +ev.date.slice(0, 4)
      oldMinusByYear[y] = (oldMinusByYear[y] ?? 0) + -ev.pnlEur
    }
  for (const l of p.fiscal?.manualLosses ?? []) {
    const y = +String(l.date).slice(0, 4)
    oldMinusByYear[y] = (oldMinusByYear[y] ?? 0) + Math.abs(parseFloat(l.amount) || 0)
  }
  for (const y of [...years].sort()) {
    const oP = old.dettaglioPlus.filter(x => x.anno === y)
    const nL = nuovo.fiscal.lines.filter(l => l.year === y)
    const sum = (arr, k) => arr.reduce((s, x) => s + (x[k] ?? 0), 0)
    log(`| ${y} | ${f(sum(oP, 'plusEur'))} | ${f(sum(nL.filter(l => l.gainEur > 0), 'gainEur'))} | ${f(oldMinusByYear[y] ?? 0)} | ${f(-sum(nL.filter(l => l.gainEur < 0), 'gainEur'))} | ${f(sum(oP, 'residuoTassabileEur'))} | ${f(sum(nL, 'taxableEur'))} |`)
  }
  log(`\nMinus ancora disponibili — vecchio: ${old.residuoFinale.strumenti.map(b => `${b.anno}: ${f(b.residuo)}`).join(', ') || 'nessuna'}`)
  log(`Minus ancora disponibili — nuovo: ${nuovo.fiscal.buckets.filter(b => b.remainingEur > 0.005).map(b => `${b.year} (scade ${b.expiresYear}): ${f(b.remainingEur)}`).join(', ') || 'nessuna'}`)

  const shortEv = nuovo.fiscal.lines.filter(l => l.side === 'short')
  if (shortEv.length) log(`\nChiusure di short nel cassetto (assenti nel vecchio motore): ${shortEv.length}, totale ${f(shortEv.reduce((s, l) => s + l.gainEur, 0))} €`)

  log(`\n### Vendite: risultato per movimento (solo differenze > 0,01 €)\n`)
  log(`| Data | Titolo | Vecchio € | Nuovo € | Motivo probabile |`)
  log(`|---|---|---|---|---|`)
  let evDiff = 0
  for (const [id, a] of Object.entries(p.assets ?? {})) {
    const o = Calc.realizedEvents(a, regime)
    const n = nuovo.positions[id].realized.filter(e => e.side === 'long')
    const cur = (a.valuta || 'EUR').toUpperCase()
    for (let i = 0; i < Math.max(o.length, n.length); i++) {
      if (!diff(o[i]?.pnlEur, n[i]?.gainEur)) continue
      evDiff++
      const tx = (a.transactions ?? []).find(t => t.date === (n[i]?.date ?? o[i]?.date) && t.type === 'sell')
      const motivo = cur !== 'EUR' && !(a.transactions ?? []).every(t => t.exchangeRate)
        ? 'cambio: il vecchio usa quello di oggi per i movimenti senza cambio salvato'
        : tx && !tx.exchangeRate && cur !== 'EUR' ? 'cambio mancante sulla vendita' : 'da verificare'
      log(`| ${n[i]?.date ?? o[i]?.date} | ${a.ticker || a.nome} | ${f(o[i]?.pnlEur)} | ${f(n[i]?.gainEur)} | ${motivo} |`)
    }
  }
  if (!evDiff) log(`| nessuna differenza | | | | |`)
}

const report = path.join(BACKUP_DIR, 'confronto.md')
fs.writeFileSync(report, out.join('\n'))
console.log(out.join('\n'))
console.error(`\nRapporto salvato in ${report}`)
