import type { YahooDividend } from '../domain/engine/dividends.ts'
import { mapLimit, proxiedJson } from './proxy.ts'

interface YahooDivChart {
  chart?: { result?: { events?: { dividends?: Record<string, { date: number; amount: number }> } }[] }
}

export function parseYahooDividends(json: YahooDivChart): YahooDividend[] {
  const divs = json.chart?.result?.[0]?.events?.dividends
  if (!divs) return []
  return Object.values(divs)
    .map(d => ({ exDate: new Date(d.date * 1000).toISOString().slice(0, 10), amount: Number(d.amount) || 0 }))
    .filter(d => d.amount > 0)
    .sort((a, b) => a.exDate.localeCompare(b.exDate))
}

const CACHE_KEY = 'ptpro_v2_dividends'
const TTL = 24 * 60 * 60 * 1000

/** Dividendi storici per titolo (Yahoo, via Worker, ultimi 10 anni). Cache di 24 ore; chi non risponde resta fuori. */
export async function loadDividends(symbols: string[]): Promise<Record<string, YahooDividend[]>> {
  let cache: Record<string, { at: number; divs: YahooDividend[] }> = {}
  try {
    cache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}')
  } catch {
    /* cache illeggibile */
  }
  const now = Date.now()
  const stale = [...new Set(symbols)].filter(s => !(cache[s] && now - cache[s].at < TTL))
  await mapLimit(stale, 4, async s => {
    try {
      const json = await proxiedJson<YahooDivChart>(
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?interval=1d&range=10y&events=dividends`,
        15000,
      )
      cache[s] = { at: now, divs: parseYahooDividends(json) }
    } catch {
      /* resta quello in cache, se c'è */
    }
  })
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache))
  } catch {
    /* storage non disponibile */
  }
  return Object.fromEntries(symbols.filter(s => cache[s]).map(s => [s, cache[s]!.divs]))
}
