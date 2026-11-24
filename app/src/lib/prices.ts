import { mapLimit, proxiedJson } from './proxy.ts'

export interface Quote {
  symbol: string
  price: number
  previousClose: number | null
  currency: string
  time: number // ms
  /** Minimo e massimo delle ultime 52 settimane. */
  low52?: number | null
  high52?: number | null
  /** Prezzi della giornata (ogni 5 minuti, al massimo ~40 punti) per il grafichino. */
  spark?: number[]
  /** Pre-market o after-market (borse USA): ultimo prezzo fuori orario e variazione sul prezzo di chiusura. */
  ext?: ExtendedQuote | null
}

export interface ExtendedQuote {
  kind: 'pre' | 'post'
  price: number
  /** Variazione % rispetto al prezzo della seduta (regularMarketPrice), come nel sito vecchio. */
  pct: number
}

interface Period { start?: number; end?: number }

interface YahooChart {
  chart?: {
    result?: {
      meta?: {
        symbol?: string; regularMarketPrice?: number; chartPreviousClose?: number; previousClose?: number; currency?: string; regularMarketTime?: number
        fiftyTwoWeekLow?: number; fiftyTwoWeekHigh?: number
        currentTradingPeriod?: { pre?: Period; regular?: Period; post?: Period }
      }
      timestamp?: number[]
      indicators?: { quote?: { close?: (number | null)[] }[] }
    }[]
  }
}

/** Riduce una serie a ~n punti (per il grafichino del giorno). */
export function downsample(xs: number[], n = 40): number[] {
  if (xs.length <= n) return xs
  const step = (xs.length - 1) / (n - 1)
  return Array.from({ length: n }, (_, i) => xs[Math.round(i * step)]!)
}

export function parseYahoo(json: YahooChart): Quote | null {
  const res = json.chart?.result?.[0]
  const m = res?.meta
  if (!m?.symbol || !(Number(m.regularMarketPrice) > 0)) return null
  const price = Number(m.regularMarketPrice)
  const closes = res?.indicators?.quote?.[0]?.close ?? []
  const times = res?.timestamp ?? []
  const reg = m.currentTradingPeriod?.regular
  const pre = m.currentTradingPeriod?.pre
  const post = m.currentTradingPeriod?.post
  const points = closes
    .map((c, i) => ({ t: times[i], c }))
    .filter((p): p is { t: number | undefined; c: number } => typeof p.c === 'number' && p.c > 0)
  // Grafichino: solo la seduta normale (se si conoscono gli orari); il fuori orario si mostra a parte.
  const inRegular = (t: number | undefined) => t === undefined || !reg?.start || !reg.end || (t >= reg.start && t <= reg.end)
  // Fuori orario: l'ultimo prezzo è prima dell'apertura (pre-market) o dopo la chiusura (after-market).
  // L'asta di chiusura delle borse europee cade proprio sull'orario di chiusura: è seduta normale, non after-market.
  let ext: ExtendedQuote | null = null
  const last = points.at(-1)
  if (last?.t !== undefined && reg?.start && reg.end) {
    const kind = last.t > reg.end && (!post?.start || last.t >= post.start) ? 'post'
      : last.t < reg.start && (!pre?.start || last.t >= pre.start) ? 'pre' : null
    if (kind) ext = { kind, price: Number(last.c.toPrecision(6)), pct: ((last.c - price) / price) * 100 }
  }
  return {
    symbol: m.symbol,
    price,
    previousClose: Number(m.previousClose ?? m.chartPreviousClose) || null,
    currency: (m.currency || 'EUR').toUpperCase(),
    time: (m.regularMarketTime ?? 0) * 1000,
    low52: Number(m.fiftyTwoWeekLow) || null,
    high52: Number(m.fiftyTwoWeekHigh) || null,
    spark: downsample(points.filter(p => inRegular(p.t)).map(p => p.c)).map(x => Number(x.toPrecision(6))),
    ext,
  }
}

const CACHE_KEY = 'ptpro_v2_quotes_4' // _4: con pre-market e after-market
const TTL = 5 * 60 * 1000

/** Ultimi prezzi (Yahoo, via Worker). Cache di 5 minuti: si apre subito anche offline. `force`: ignora la cache (pulsante Aggiorna). */
export async function loadQuotes(symbols: string[], force = false): Promise<Record<string, Quote>> {
  let cache: Record<string, Quote & { at: number }> = {}
  try {
    cache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}')
  } catch {
    /* cache illeggibile */
  }
  const now = Date.now()
  const stale = [...new Set(symbols)].filter(s => force || !(cache[s] && now - cache[s].at < TTL))
  await mapLimit(stale, 6, async s => {
    try {
      const q = parseYahoo(
        // range=1d: così chartPreviousClose è la chiusura di ieri (con 5d sarebbe di 5 giorni fa).
        // interval=5m: nella stessa risposta ci sono i prezzi della giornata per il grafichino.
        // includePrePost: anche i prezzi di pre-market e after-market (borse USA).
        await proxiedJson<YahooChart>(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?interval=5m&range=1d&includePrePost=true`),
      )
      if (q) cache[s] = { ...q, at: now }
    } catch {
      /* resta il prezzo in cache, se c'è */
    }
  })
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache))
  } catch {
    /* storage non disponibile */
  }
  return Object.fromEntries(symbols.filter(s => cache[s]).map(s => [s, cache[s]!]))
}

/** Quotazioni fresche se possibile, altrimenti quelle salvate (anche vecchie): per mostrare subito qualcosa. */
export function cachedQuotes(): Record<string, Quote & { at?: number }> {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}')
  } catch {
    return {}
  }
}

/** Cambio attuale (unità per 1 EUR) per valorizzare le posizioni oggi. */
export async function loadLatestFx(): Promise<Record<string, number>> {
  try {
    const j = await proxiedJson<{ result?: string; rates?: Record<string, number> }>('https://open.er-api.com/v6/latest/EUR')
    return j.result === 'success' && j.rates ? j.rates : {}
  } catch {
    return {}
  }
}
