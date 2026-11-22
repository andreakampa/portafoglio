import type { FxLookup } from '../domain/engine/types.ts'
import { mapLimit, proxiedJson } from './proxy.ts'

// Cambi storici ufficiali Banca d'Italia: unità di valuta per 1 EUR.
// Una richiesta per data restituisce tutte le valute. I cambi passati non cambiano più,
// quindi restano in cache nel browser per sempre (localStorage).

const CACHE_KEY = 'ptpro_v2_fx'
type DayRates = Record<string, number> | null // null = nessuna quotazione (festivo)

function readCache(): Record<string, DayRates> {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}') as Record<string, DayRates>
  } catch {
    return {}
  }
}

function writeCache(c: Record<string, DayRates>) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(c))
  } catch {
    /* storage pieno o non disponibile: si rifarà la richiesta */
  }
}

interface BdiResponse {
  rates?: { isoCode: string; avgRate: string }[]
}

export function parseBdi(json: BdiResponse): DayRates {
  const out: Record<string, number> = {}
  for (const r of json.rates ?? []) {
    const v = parseFloat(r.avgRate)
    if (r.isoCode && v > 0) out[r.isoCode] = v
  }
  return Object.keys(out).length ? out : null
}

const previousDay = (date: string) => new Date(Date.parse(date + 'T12:00:00Z') - 86400000).toISOString().slice(0, 10)

/**
 * Carica i cambi per le date indicate (risalendo fino a 7 giorni per weekend e festivi)
 * e restituisce la funzione di lookup per il motore. Le date future o di oggi non si chiedono.
 */
export async function loadFx(dates: Iterable<string>, fetchDay = fetchBdiDay): Promise<FxLookup> {
  const cache = readCache()
  const today = new Date().toISOString().slice(0, 10)
  const wanted = [...new Set(dates)].filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d) && d < today)

  const resolved = new Map<string, string>() // data richiesta -> data con quotazione
  const resolve = async (date: string) => {
    let d = date
    for (let i = 0; i < 8; i++) {
      if (!(d in cache)) cache[d] = await fetchDay(d).catch(() => undefined as unknown as DayRates)
      if (cache[d]) return resolved.set(date, d)
      if (cache[d] === undefined) delete cache[d] // errore di rete: non salvarlo come festivo
      d = previousDay(d)
    }
  }
  await mapLimit(wanted, 6, resolve)
  writeCache(cache)

  return (currency, date) => {
    const day = resolved.get(date)
    return day ? (cache[day]?.[currency.toUpperCase()] ?? undefined) : undefined
  }
}

async function fetchBdiDay(date: string): Promise<DayRates> {
  const url = `https://tassidicambio.bancaditalia.it/terzevalute-wf-web/rest/v1.0/dailyRates?lang=it&currencyIsoCode=EUR&referenceDate=${date}`
  return parseBdi(await proxiedJson<BdiResponse>(url))
}

/**
 * Per i movimenti degli ultimi giorni il cambio ufficiale può non essere ancora pubblicato (la Banca d'Italia
 * lo pubblica nel pomeriggio, e non nei festivi): nel frattempo si usa quello di oggi, poi quello vero sostituisce
 * da solo il provvisorio. I movimenti più vecchi restano senza cambio (e segnalati) se manca quello storico.
 */
export function withRecentFallback(fx: FxLookup, latest: Record<string, number>, today: string, days = 7): FxLookup {
  const from = new Date(Date.parse(today + 'T12:00:00Z') - days * 86400000).toISOString().slice(0, 10)
  return (currency, date) => fx(currency, date) ?? (date >= from ? latest[currency.toUpperCase()] : undefined)
}
