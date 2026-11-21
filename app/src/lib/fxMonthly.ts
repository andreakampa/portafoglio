import type { MonthlyFx } from '../domain/engine/taxReturn.ts'
import { mapLimit, proxiedJson } from './proxy.ts'

// Cambi medi mensili della Banca d'Italia (unità di valuta per 1 EUR): sono quelli del provvedimento
// dell'Agenzia delle Entrate da usare nel quadro RW. I mesi chiusi non cambiano più: cache per sempre.

const CACHE_KEY = 'ptpro_v2_fx_monthly'
type MonthRates = Record<string, number> | null

function readCache(): Record<string, MonthRates> {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}') as Record<string, MonthRates>
  } catch {
    return {}
  }
}

function writeCache(c: Record<string, MonthRates>) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(c))
  } catch {
    /* storage pieno: si rifarà la richiesta */
  }
}

interface BdiMonthly {
  rates?: { isoCode: string; avgRate: string }[]
}

export function parseMonthly(json: BdiMonthly): MonthRates {
  const out: Record<string, number> = {}
  for (const r of json.rates ?? []) {
    const v = parseFloat(r.avgRate)
    if (r.isoCode && v > 0) out[r.isoCode] = v
  }
  return Object.keys(out).length ? out : null
}

/**
 * Carica i cambi medi dei mesi `YYYY-MM` indicati. Per il mese in corso (non ancora pubblicato)
 * si usa `fallback` (es. i cambi di oggi): il valore resta provvisorio.
 */
export async function loadMonthlyFx(months: Iterable<string>, fallback: Record<string, number> = {}): Promise<MonthlyFx> {
  const cache = readCache()
  const thisMonth = new Date().toISOString().slice(0, 7)
  const wanted = [...new Set(months)].filter(m => /^\d{4}-\d{2}$/.test(m) && m < thisMonth && !cache[m])
  await mapLimit(wanted, 4, async m => {
    const [y, mm] = m.split('-')
    const url = `https://tassidicambio.bancaditalia.it/terzevalute-wf-web/rest/v1.0/monthlyAverageRates?lang=it&currencyIsoCode=EUR&year=${y}&month=${Number(mm)}`
    try {
      const rates = parseMonthly(await proxiedJson<BdiMonthly>(url))
      if (rates) cache[m] = rates
    } catch {
      /* rete: riprova la prossima volta */
    }
  })
  writeCache(cache)
  return (currency, month) => {
    const c = currency.toUpperCase()
    if (month >= thisMonth) return fallback[c]
    return cache[month]?.[c] ?? undefined
  }
}
