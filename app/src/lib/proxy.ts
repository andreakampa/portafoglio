// Worker Cloudflare (workers/finance-proxy): accetta solo il sito e localhost,
// e contatta solo Yahoo Finance, open.er-api.com e Banca d'Italia.
export const PROXY = 'https://finance-proxy.andrea-kampa.workers.dev'

export async function proxiedJson<T>(url: string, timeoutMs = 10000): Promise<T> {
  const r = await fetch(`${PROXY}?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(timeoutMs) })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return (await r.json()) as T
}

/** Esegue `fn` su tutti gli elementi con al massimo `limit` richieste contemporanee. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}
