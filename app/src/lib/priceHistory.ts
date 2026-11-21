import { proxiedJson } from './proxy.ts'

interface YahooHistory {
  chart?: { result?: { timestamp?: number[]; indicators?: { quote?: { close?: (number | null)[] }[] } }[] }
}

/** Chiusure giornaliere (data → prezzo) dalla risposta di Yahoo. I giorni senza prezzo restano fuori. */
export function parseCloses(json: YahooHistory): Record<string, number> {
  const r = json.chart?.result?.[0]
  const closes = r?.indicators?.quote?.[0]?.close ?? []
  const out: Record<string, number> = {}
  ;(r?.timestamp ?? []).forEach((t, i) => {
    const c = closes[i]
    if (typeof c === 'number' && c > 0) out[new Date(t * 1000).toISOString().slice(0, 10)] = c
  })
  return out
}

/** Chiusure degli ultimi 2 anni di un titolo (Yahoo, via Worker). */
export async function loadCloses(symbol: string): Promise<Record<string, number>> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=2y`
  return parseCloses(await proxiedJson<YahooHistory>(url, 15000))
}
