// Watchlist e avvisi di prezzo. Funzioni pure, usate dall'app e dal Worker che manda le notifiche.

export interface WatchItem {
  id: string
  /** Simbolo Yahoo (es. NVDA, RACE.MI). */
  symbol: string
  name?: string
  note?: string
  /** Avviso quando il prezzo sale fino a / sopra questa soglia. */
  above?: number
  /** Avviso quando il prezzo scende fino a / sotto questa soglia. */
  below?: number
  /** Avvisi già mandati: si riarmano quando il prezzo torna dall'altra parte della soglia. */
  fired?: { above?: boolean; below?: boolean }
  addedAt?: string
  /** 'ibkr' = arriva dalle watchlist del conto IBKR; assente = aggiunto a mano nell'app. */
  source?: string
  /** Liste IBKR in cui si trova (per il filtro). */
  lists?: string[]
  /** Simbolo com'è su IBKR (può essere diverso da quello di Yahoo). */
  ibkrSymbol?: string
  /** Era in una watchlist IBKR ma non c'è più: resta nell'app finché non lo togli tu. */
  goneFromIbkr?: boolean
}

export interface AlertHit {
  id: string
  symbol: string
  kind: 'above' | 'below'
  threshold: number
  price: number
}

/**
 * Controlla le soglie. Un avviso scatta una volta sola quando il prezzo la raggiunge,
 * e si riarma quando il prezzo torna indietro (così non arriva una notifica ogni 15 minuti).
 */
export function checkAlerts(items: WatchItem[], prices: Record<string, number | undefined>): { hits: AlertHit[]; fired: Record<string, WatchItem['fired']> } {
  const hits: AlertHit[] = []
  const fired: Record<string, WatchItem['fired']> = {}
  for (const it of items) {
    const p = prices[it.symbol]
    if (!(p && p > 0)) continue
    const was = it.fired ?? {}
    const now = { ...was }
    if (it.above != null && it.above > 0) {
      const on = p >= it.above
      if (on && !was.above) hits.push({ id: it.id, symbol: it.symbol, kind: 'above', threshold: it.above, price: p })
      now.above = on
    }
    if (it.below != null && it.below > 0) {
      const on = p <= it.below
      if (on && !was.below) hits.push({ id: it.id, symbol: it.symbol, kind: 'below', threshold: it.below, price: p })
      now.below = on
    }
    if (!!now.above !== !!was.above || !!now.below !== !!was.below) fired[it.id] = now
  }
  return { hits, fired }
}

export const alertText = (h: AlertHit) =>
  `${h.symbol} ${h.kind === 'above' ? 'è salito a' : 'è sceso a'} ${h.price.toLocaleString('it-IT', { maximumFractionDigits: 2 })} (soglia ${h.threshold.toLocaleString('it-IT')})`

// ── Importazione da IBKR ──────────────────────────────────────────────────────

/** Borsa IBKR → suffisso Yahoo. Le borse USA non hanno suffisso. */
const EXCHANGE_SUFFIX: Record<string, string> = {
  BVME: '.MI', BIT: '.MI', MIL: '.MI',
  IBIS: '.DE', XETRA: '.DE', FWB: '.F', GETTEX: '.DE',
  AEB: '.AS', SBF: '.PA', ENEXT: '.PA', EBS: '.SW', SWX: '.SW',
  LSE: '.L', LSEETF: '.L', BM: '.MC', BME: '.MC',
  TSE: '.TO', TSX: '.TO', VENTURE: '.V', SEHK: '.HK', ASX: '.AX', TSEJ: '.T',
}

/** Simbolo IBKR (+ borsa) → simbolo Yahoo. "RACEm" di Borsa Italiana → RACE.MI; "BRK B" → BRK-B. */
export function yahooSymbol(symbol: string, exchange?: string): string {
  let s = symbol.trim().toUpperCase().replace(/\s+/g, '-')
  const ex = (exchange ?? '').trim().toUpperCase()
  if (/^[A-Z0-9]+M$/i.test(symbol.trim()) && symbol.trim().endsWith('m') && (ex === '' || ex === 'BVME')) {
    return s.slice(0, -1) + '.MI' // IBKR aggiunge una "m" minuscola ai titoli di Borsa Italiana
  }
  if (s.includes('.')) return s
  const suffix = EXCHANGE_SUFFIX[ex]
  if (suffix) s += suffix
  return s
}

function splitCsv(line: string, sep: string): string[] {
  const out: string[] = []
  let cur = ''
  let q = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!
    if (q) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"'
        i++
      } else if (ch === '"') q = false
      else cur += ch
    } else if (ch === '"') q = true
    else if (ch === sep) {
      out.push(cur.trim())
      cur = ''
    } else cur += ch
  }
  out.push(cur.trim())
  return out
}

const SYMBOL_COLS = ['symbol', 'simbolo', 'ticker', 'financial instrument', 'strumento finanziario', 'strumento', 'instrument']
const EXCHANGE_COLS = ['exchange', 'listing exch', 'primary exchange', 'borsa', 'mercato', 'exch']
const NAME_COLS = ['description', 'descrizione', 'company name', 'name', 'nome']

/**
 * Legge una watchlist esportata da IBKR (TWS o Portale, CSV) o un semplice elenco di simboli.
 * Usa le colonne Simbolo / Borsa / Descrizione se ci sono, altrimenti la prima colonna. Niente doppioni.
 */
export function parseWatchlistCsv(text: string): { symbol: string; name?: string }[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  if (!lines.length) return []
  const sep = [',', ';', '\t'].map(s => ({ s, n: lines[0]!.split(s).length })).sort((a, b) => b.n - a.n)[0]!.s
  const head = splitCsv(lines[0]!, sep).map(h => h.toLowerCase())
  const find = (names: string[]) => head.findIndex(h => names.includes(h))
  let si = find(SYMBOL_COLS)
  const ei = find(EXCHANGE_COLS)
  const ni = find(NAME_COLS)
  const rows = si >= 0 ? lines.slice(1) : lines
  if (si < 0) si = 0
  const seen = new Set<string>()
  const out: { symbol: string; name?: string }[] = []
  for (const line of rows) {
    const cells = splitCsv(line, sep)
    // "Strumento finanziario" di TWS può essere "AAPL NASDAQ.NMS" o "RACE BVME": primo pezzo = simbolo.
    const raw = (cells[si] ?? '').replace(/[;,\t]+$/, '').split(/\s+(?=[A-Z.]{2,}$)/)[0]!.trim()
    if (!raw || !/^[A-Za-z0-9.\- ]{1,20}$/.test(raw) || /^(symbol|simbolo|ticker)$/i.test(raw)) continue
    const embeddedEx = (cells[si] ?? '').trim().split(/\s+/)[1]
    const symbol = yahooSymbol(raw, ei >= 0 ? cells[ei] : embeddedEx?.split('.')[0])
    if (seen.has(symbol)) continue
    seen.add(symbol)
    const name = ni >= 0 ? cells[ni] : undefined
    out.push(name ? { symbol, name } : { symbol })
  }
  return out
}

/** Id adatto a una chiave Firebase. */
export const watchId = (symbol: string) => symbol.toUpperCase().replace(/[.$#[\]/\s]/g, '_')

// ── Allineamento con le watchlist IBKR (solo aggiunte, mai cancellazioni) ──────

export interface IbkrWatchEntry {
  /** Simbolo Yahoo già convertito. */
  symbol: string
  ibkrSymbol: string
  name?: string
  lists: string[]
}

/**
 * Cosa scrivere su Firebase (percorso relativo a settings/watchlist → valore) per allineare la watchlist dell'app
 * a quella di IBKR. Regole decise con Andrea:
 * - i titoli nuovi su IBKR si aggiungono;
 * - quelli già presenti tengono soglie e note: si aggiornano solo le liste;
 * - i titoli aggiunti a mano non si toccano mai (al più ricevono le liste se ci sono anche su IBKR);
 * - un titolo arrivato da IBKR e poi tolto là NON si cancella: viene solo segnato goneFromIbkr.
 */
export function mergeIbkrWatchlists(existing: WatchItem[], imported: IbkrWatchEntry[], now: string): { writes: Record<string, unknown>; added: string[]; updated: string[]; gone: string[] } {
  const writes: Record<string, unknown> = {}
  const added: string[] = []
  const updated: string[] = []
  const gone: string[] = []
  const bySymbol = new Map(existing.map(it => [it.symbol.toUpperCase(), it]))
  const seen = new Set<string>()
  for (const e of imported) {
    const key = e.symbol.toUpperCase()
    seen.add(key)
    const lists = [...new Set(e.lists)].sort((a, b) => a.localeCompare(b))
    const cur = bySymbol.get(key)
    if (!cur) {
      writes[watchId(e.symbol)] = { symbol: e.symbol, ...(e.name ? { name: e.name } : {}), source: 'ibkr', ibkrSymbol: e.ibkrSymbol, lists, addedAt: now }
      added.push(e.symbol)
      continue
    }
    const same = JSON.stringify(cur.lists ?? []) === JSON.stringify(lists) && !cur.goneFromIbkr
    if (same) continue
    writes[`${cur.id}/lists`] = lists
    if (cur.goneFromIbkr) writes[`${cur.id}/goneFromIbkr`] = null
    updated.push(cur.symbol)
  }
  for (const it of existing) {
    if (it.source === 'ibkr' && !it.goneFromIbkr && !seen.has(it.symbol.toUpperCase())) {
      writes[`${it.id}/goneFromIbkr`] = true
      gone.push(it.symbol)
    }
  }
  return { writes, added, updated, gone }
}

/** Liste presenti nella watchlist, con quanti titoli ha ciascuna (per il filtro). */
export function listCounts(items: WatchItem[]): { name: string; count: number }[] {
  const m = new Map<string, number>()
  for (const it of items) for (const l of it.lists ?? []) m.set(l, (m.get(l) ?? 0) + 1)
  return [...m].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name))
}
