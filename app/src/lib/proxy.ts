// Worker Cloudflare (workers/finance-proxy): accetta solo il sito pubblicato, ha un limite di
// richieste al minuto e contatta solo Yahoo Finance, open.er-api.com e Banca d'Italia.
export const PROXY_URL = 'https://finance-proxy.andrea-kampa.workers.dev'

/** In locale (npm run dev / preview) si passa dall'inoltro di Vite (vite.config.ts), perché il Worker non accetta localhost. */
export function proxyBase(hostname: string = globalThis.location?.hostname ?? ''): string {
  return hostname === 'localhost' || hostname === '127.0.0.1' ? '/__proxy' : PROXY_URL
}

export const PROXY = proxyBase()

const sleep = (ms: number) => new Promise(res => setTimeout(res, ms))

export async function proxiedJson<T>(url: string, timeoutMs = 10000): Promise<T> {
  const target = `${PROXY}?url=${encodeURIComponent(url)}`
  let r = await fetch(target, { signal: AbortSignal.timeout(timeoutMs) })
  // Oltre il limite del Worker: si aspetta (al massimo 30 secondi) e si riprova una volta.
  if (r.status === 429) {
    const wait = Math.min(Number(r.headers.get('Retry-After')) || 10, 30)
    await sleep(wait * 1000)
    r = await fetch(target, { signal: AbortSignal.timeout(timeoutMs) })
  }
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
