import { mapLimit, proxiedJson } from './proxy.ts'

export interface Quote {
  symbol: string
  price: number
  previousClose: number | null
  currency: string
  time: number // ms
}

interface YahooChart {
  chart?: {
    result?: { meta?: { symbol?: string; regularMarketPrice?: number; chartPreviousClose?: number; previousClose?: number; currency?: string; regularMarketTime?: number } }[]
  }
}

export function parseYahoo(json: YahooChart): Quote | null {
  const m = json.chart?.result?.[0]?.meta
  if (!m?.symbol || !(Number(m.regularMarketPrice) > 0)) return null
  return {
    symbol: m.symbol,
    price: Number(m.regularMarketPrice),
    previousClose: Number(m.previousClose ?? m.chartPreviousClose) || null,
    currency: (m.currency || 'EUR').toUpperCase(),
    time: (m.regularMarketTime ?? 0) * 1000,
  }
}

const CACHE_KEY = 'ptpro_v2_quotes_2' // _2: scarta le chiusure "di 5 giorni fa" salvate prima
const TTL = 5 * 60 * 1000

/** Ultimi prezzi (Yahoo, via Worker). Cache di 5 minuti: si apre subito anche offline. */
export async function loadQuotes(symbols: string[]): Promise<Record<string, Quote>> {
  let cache: Record<string, Quote & { at: number }> = {}
  try {
    cache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}')
  } catch {
    /* cache illeggibile */
  }
  const now = Date.now()
  const stale = [...new Set(symbols)].filter(s => !(cache[s] && now - cache[s].at < TTL))
  await mapLimit(stale, 6, async s => {
    try {
      const q = parseYahoo(
        // range=1d: così chartPreviousClose è la chiusura di ieri (con 5d sarebbe di 5 giorni fa).
        await proxiedJson<YahooChart>(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?interval=1d&range=1d`),
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
export function cachedQuotes(): Record<string, Quote> {
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
