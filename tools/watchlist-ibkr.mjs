// Allinea la watchlist dell'app con le watchlist del conto IBKR (solo aggiunte, mai cancellazioni).
//
// Uso (lo fa l'attività settimanale di Claude, vedi docs/stato-progetto.md):
//   1. le watchlist IBKR lette con il connettore IBKR → .backup/ibkr-watchlists.json
//      formato: [{ "name": "Quantum", "instruments": [{ "contract_id_ex": "517593749", "contract_description": "IONQ" }] }]
//   2. la watchlist attuale: firebase database:get /users/<uid>/settings/watchlist -o .backup/watchlist-attuale.json
//   3. node --experimental-strip-types tools/watchlist-ibkr.mjs
//      → .backup/watchlist-patch.json (da scrivere con firebase database:update /users/<uid>/settings/watchlist)
//      e il riepilogo a schermo. Non scrive su Firebase da solo.
//
// Regole (mergeIbkrWatchlists in app/src/domain/watchlist.ts): titoli nuovi aggiunti; soglie e note mai toccate;
// titoli aggiunti a mano mai toccati; titoli tolti da IBKR solo segnati "non più su IBKR".

import fs from 'node:fs'
import path from 'node:path'
import { mergeIbkrWatchlists, yahooSymbol } from '../app/src/domain/watchlist.ts'

const ROOT = path.resolve(import.meta.dirname, '..')
const B = p => path.join(ROOT, '.backup', p)
const PROXY = 'https://finance-proxy.andrea-kampa.workers.dev'

// Simboli che IBKR scrive in modo diverso da Yahoo (indici, cambi, cripto, titoli italiani senza borsa indicata).
const KNOWN = {
  SPX: '^GSPC', NDX: '^NDX', VIX: '^VIX', VXN: '^VXN', RUT: '^RUT', DJI: '^DJI', INDU: '^DJI', ESTX50: '^STOXX50E', DAX: '^GDAXI',
  'EUR.USD': 'EURUSD=X', 'GBP.USD': 'GBPUSD=X', 'USD.JPY': 'JPY=X', 'EUR.CHF': 'EURCHF=X', 'USD.CAD': 'CAD=X',
  STLAP: 'STLAM.MI', NUKL: 'NUKL.DE', BANB: 'BANB.SW',
}
const SUFFIXES = ['.MI', '.DE', '.AS', '.PA', '.SW', '.L', '.MC', '.TO']

async function quote(symbol) {
  const url = `${PROXY}?url=${encodeURIComponent(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`)}`
  try {
    const j = await (await fetch(url, { headers: { Origin: 'https://andreakampa.github.io' } })).json()
    const m = j.chart?.result?.[0]?.meta
    return m?.regularMarketPrice ? { name: m.longName || m.shortName || '' } : null
  } catch {
    return null
  }
}

/** Simbolo Yahoo per uno strumento IBKR: tabella, borsa indicata (@BVME…), cripto; poi prova con i suffissi più comuni. */
async function resolve(desc, idEx) {
  const [, exchange = ''] = String(idEx).split('@')
  if (exchange === 'ZEROHASH' || exchange === 'PAXOS') return { symbol: `${desc}-USD`, ...((await quote(`${desc}-USD`)) ?? {}) }
  const first = KNOWN[desc] ?? yahooSymbol(desc, exchange)
  const q = await quote(first)
  if (q) return { symbol: first, ...q }
  if (!first.includes('.') && !first.startsWith('^')) {
    for (const s of SUFFIXES) {
      const r = await quote(desc + s)
      if (r) return { symbol: desc + s, ...r }
    }
  }
  return { symbol: first, notFound: true }
}

const lists = JSON.parse(fs.readFileSync(B('ibkr-watchlists.json'), 'utf8'))
const current = JSON.parse(fs.readFileSync(B('watchlist-attuale.json'), 'utf8') || 'null') ?? {}
const existing = Object.entries(current).map(([id, it]) => ({ ...it, id }))

const byIbkr = new Map()
for (const l of lists) {
  for (const ins of l.instruments ?? []) {
    const k = ins.contract_description
    const e = byIbkr.get(k) ?? { idEx: ins.contract_id_ex, lists: [] }
    e.lists.push(l.name.trim())
    byIbkr.set(k, e)
  }
}

const imported = []
const notFound = []
for (const [desc, e] of byIbkr) {
  // Già in watchlist con lo stesso simbolo IBKR: non serve richiedere Yahoo.
  const known = existing.find(it => it.ibkrSymbol === desc)
  const r = known ? { symbol: known.symbol } : await resolve(desc, e.idEx)
  if (r.notFound) notFound.push(desc)
  imported.push({ symbol: r.symbol, ibkrSymbol: desc, ...(r.name ? { name: r.name } : {}), lists: e.lists })
}

const { writes, added, updated, gone } = mergeIbkrWatchlists(existing, imported, new Date().toISOString())
for (const s of notFound) {
  const id = s.toUpperCase().replace(/[.$#[\]/\s]/g, '_')
  if (writes[id] && typeof writes[id] === 'object') writes[id].note = 'Simbolo da controllare: Yahoo non lo trova.'
}
fs.writeFileSync(B('watchlist-patch.json'), JSON.stringify(writes))
console.log(JSON.stringify({ listeIbkr: lists.length, titoliIbkr: byIbkr.size, aggiunti: added, listeAggiornate: updated.length, nonPiuSuIbkr: gone, simboliDaControllare: notFound, scritture: Object.keys(writes).length }, null, 1))
