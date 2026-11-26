// Margine del conto IBKR: quanto ne sto usando, leva e interessi. Funzioni pure, senza rete.
// Il margine è il saldo di cassa negativo (ogni vendita lo riduce): non lo si attribuisce ai singoli titoli.

import type { MarginDayRow, MarginStatus } from '../ibkr/sync.ts'
import type { MarginInterestRow } from './movements.ts'
import type { RawPortfolio } from './portfolio.ts'
import type { PositionRow } from './valuation.ts'

export type MarginPortfolio = RawPortfolio & {
  marginStatus?: MarginStatus
  marginDaily?: MarginDayRow[]
  marginHistoryFrom?: string
  marginInterest?: MarginInterestRow[]
}

export interface MarginBalance {
  currency: string
  /** Saldo di cassa nella valuta (negativo = a debito). */
  cash: number
  /** Interessi maturati e non ancora addebitati (negativo = a debito). */
  accrued: number
  ratePct: number | null
  /** Debito in EUR al cambio di oggi (null se manca il cambio). */
  debtEur: number | null
}

export interface MarginSummary {
  /** Data del report IBKR da cui arrivano i saldi. */
  date: string
  balances: MarginBalance[]
  /** Margine usato: debito netto di tutte le valute, in EUR (0 se il saldo netto è positivo). */
  usedEur: number
  /** Esposizione lorda (long + short in valore assoluto) e patrimonio netto (titoli + cassa), in EUR. */
  grossEur: number
  equityEur: number
  /** Valore netto delle posizioni (long − |short|), in EUR. */
  positionsEur: number
  /** Esposizione lorda / patrimonio netto (1,00x = nessuna leva). null se non calcolabile. */
  leverage: number | null
  /** Titoli senza prezzo: esclusi da esposizione e patrimonio, la leva è approssimata. */
  missingPrices: number
  /** Costo stimato di un giorno e di un mese col tasso attuale. */
  dailyCostEur: number
  monthlyCostEur: number
  /** Interessi addebitati nell'anno e maturati non ancora addebitati, in EUR al cambio di oggi. */
  paidYearEur: number
  accruedEur: number
  /** Valute a debito per cui manca il tasso o il cambio: non entrano nelle stime. */
  incomplete: string[]
}

// IBKR calcola gli interessi su 360 giorni, tranne alcune valute su 365.
const DAYS_365 = new Set(['GBP', 'CAD', 'AUD', 'NZD', 'HKD', 'SGD', 'ZAR'])
const round = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d

/** Riassunto del margine; null se il portafoglio non ha una foto del margine (non è un conto IBKR sincronizzato). */
export function summarizeMargin(
  p: MarginPortfolio,
  rows: PositionRow[],
  latestFx: Record<string, number>,
  year: number,
): MarginSummary | null {
  const st = p.marginStatus
  if (!st || !st.balances?.length) return null
  const toEur = (amount: number, currency: string) => {
    if (currency === 'EUR') return amount
    const r = latestFx[currency]
    return r ? amount / r : null
  }

  const incomplete: string[] = []
  const balances: MarginBalance[] = st.balances.map(b => ({
    currency: b.currency,
    cash: b.endingCash,
    accrued: b.accrued,
    ratePct: b.ratePct ?? null, // Firebase non conserva i null: il campo può mancare
    debtEur: b.endingCash < 0 ? toEur(-b.endingCash, b.currency) : 0,
  }))

  let dailyCostEur = 0
  for (const b of balances) {
    if (b.cash >= 0) continue
    if (b.ratePct == null || b.debtEur === null) {
      incomplete.push(b.currency)
      continue
    }
    dailyCostEur += (b.debtEur * b.ratePct) / 100 / (DAYS_365.has(b.currency) ? 365 : 360)
  }

  // Il totale netto è quello di IBKR (riga in euro del report); senza, si somma dalle valute.
  const netEur =
    st.baseCash ?? (balances.every(b => b.debtEur !== null) ? -balances.reduce((s, b) => s + (b.cash >= 0 ? (toEur(b.cash, b.currency) ?? 0) : -(b.debtEur ?? 0)), 0) : null)
  const usedEur = netEur === null ? 0 : Math.max(0, -netEur)

  let grossEur = 0
  let valueEur = 0
  let missingPrices = 0
  for (const r of rows) {
    if (r.qty === 0) continue
    if (r.valueEur === null) {
      missingPrices++
      continue
    }
    grossEur += Math.abs(r.valueEur)
    valueEur += r.valueEur
  }
  const equityEur = valueEur + (netEur ?? 0)
  const leverage = netEur !== null && equityEur > 0 && grossEur > 0 ? grossEur / equityEur : null

  const paidYearEur = (p.marginInterest ?? [])
    .filter(r => r?.period?.startsWith(`${year}-`))
    .reduce((s, r) => s + (toEur(Number(r.amount) || 0, (r.currency || 'EUR').toUpperCase()) ?? 0), 0)
  const accruedEur = -balances.reduce((s, b) => s + (b.accrued < 0 ? (toEur(b.accrued, b.currency) ?? 0) : 0), 0)

  return {
    date: st.date,
    balances,
    usedEur: round(usedEur),
    grossEur: round(grossEur),
    equityEur: round(equityEur),
    positionsEur: round(valueEur),
    leverage: leverage === null ? null : round(leverage, 3),
    missingPrices,
    dailyCostEur: round(dailyCostEur),
    monthlyCostEur: round((dailyCostEur * 365) / 12),
    paidYearEur: round(paidYearEur),
    accruedEur: round(accruedEur),
    incomplete,
  }
}

/** Avviso se la leva supera la soglia scelta. */
export function leverageAlert(leverage: number | null, max: number | null): 'ok' | 'near' | 'over' | 'none' {
  if (leverage === null || max === null || !(max > 0)) return 'none'
  if (leverage > max) return 'over'
  return leverage >= max * 0.9 ? 'near' : 'ok'
}

export interface MarginOnDate {
  /** Giorno a cui si riferisce il dato (l'ultimo registrato entro 5 giorni). */
  date: string
  /** Capitale a debito per valuta (valori negativi). */
  debts: { currency: string; principal: number; ratePct: number }[]
}

/**
 * Margine in uso nel giorno di un movimento, dalle righe giornaliere salvate dalla sincronizzazione.
 * Prima che esistano righe (o se il giorno è troppo lontano) risponde null: non si inventa uno storico.
 */
export function marginOnDate(p: MarginPortfolio, date: string): MarginOnDate | null {
  const rows = p.marginDaily ?? []
  const from = p.marginHistoryFrom ?? rows[0]?.date
  if (!from || date < from) return null
  let day: string | null = null
  for (const r of rows) if (r.date <= date && (day === null || r.date > day)) day = r.date
  // Senza righe vicine, nel periodo coperto dal report il conto non aveva debito.
  if (day === null || Date.parse(date) - Date.parse(day) > 5 * 86400000) return { date, debts: [] }
  const debts = rows.filter(r => r.date === day && r.principal < 0).map(r => ({ currency: r.currency, principal: r.principal, ratePct: r.ratePct }))
  return { date: day, debts }
}

/**
 * Debito sul margine giorno per giorno, in euro, per i giorni chiesti (di solito quelli del grafico Andamento).
 * - Righe giornaliere della sincronizzazione IBKR: si usa l'ultimo giorno registrato entro 5 giorni,
 *   altrimenti (nel periodo coperto dallo storico) il conto non aveva debito. Valute convertite col cambio di mercato del giorno.
 * - Dal giorno della foto del margine in poi vale la foto (saldo netto in euro di IBKR): è la più recente.
 * - Prima dello storico si considera 0: non si inventa un debito.
 * null se il portafoglio non ha dati sul margine (non è un conto IBKR sincronizzato).
 * `fx`: unità di valuta per 1 EUR, per data (come in buildHistory).
 */
export function marginDebtByDate(p: MarginPortfolio, dates: string[], fx: Record<string, Record<string, number>>): Map<string, number> | null {
  const raw = p.marginDaily as MarginDayRow[] | Record<string, MarginDayRow> | undefined
  const rows = (Array.isArray(raw) ? raw : Object.values(raw ?? {})).filter(r => r?.date && Number.isFinite(Number(r.principal)))
  const st = p.marginStatus
  const statusDebt = st && st.balances?.length ? statusDebtEur(st) : null
  if (!rows.length && statusDebt === null) return null

  const byDay = new Map<string, MarginDayRow[]>()
  for (const r of rows) byDay.set(r.date, [...(byDay.get(r.date) ?? []), r])
  const days = [...byDay.keys()].sort()
  const lastFx = new Map<string, number>()
  const fxDays = new Map(Object.entries(fx).map(([c, s]) => [c, Object.keys(s).sort()]))
  const rateOn = (cur: string, d: string): number | null => {
    if (cur === 'EUR') return 1
    const s = fx[cur]
    const ds = fxDays.get(cur)
    if (s && ds) {
      // Ultimo cambio noto entro quel giorno (anche nei weekend).
      let lo = 0
      let hi = ds.length - 1
      let found: string | undefined
      while (lo <= hi) {
        const mid = (lo + hi) >> 1
        if (ds[mid]! <= d) {
          found = ds[mid]
          lo = mid + 1
        } else hi = mid - 1
      }
      const r = found ? s[found] : undefined
      if (r && r > 0) {
        lastFx.set(cur, r)
        return r
      }
    }
    return lastFx.get(cur) ?? null
  }

  const out = new Map<string, number>()
  let di = -1
  for (const d of [...dates].sort()) {
    if (statusDebt !== null && st && d >= st.date) {
      out.set(d, statusDebt)
      continue
    }
    while (di + 1 < days.length && days[di + 1]! <= d) di++
    const day = di >= 0 ? days[di]! : null
    if (day === null || Date.parse(d) - Date.parse(day) > 5 * 86400000) {
      out.set(d, 0)
      continue
    }
    let debt = 0
    for (const r of byDay.get(day)!) {
      const principal = Number(r.principal)
      if (principal >= 0) continue
      const rate = rateOn((r.currency || 'EUR').toUpperCase(), day)
      if (rate) debt += -principal / rate
    }
    out.set(d, round(debt))
  }
  return out
}

/** Debito netto in euro dalla foto del margine (riga in euro di IBKR, o somma delle valute in EUR se manca). */
function statusDebtEur(st: MarginStatus): number | null {
  if (st.baseCash != null && Number.isFinite(st.baseCash)) return round(Math.max(0, -st.baseCash))
  if (st.balances.every(b => b.currency === 'EUR')) return round(Math.max(0, -st.balances.reduce((s, b) => s + b.endingCash, 0)))
  return null
}
