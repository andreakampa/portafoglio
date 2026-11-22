// Numeri chiave della Panoramica. Funzione pura.

import type { FiscalLine } from './engine/fiscal.ts'
import type { PortfolioTotals, PositionRow } from './engine/valuation.ts'

export interface OverviewKpis {
  valueEur: number
  /** Variazione di oggi in euro e in % (titoli con prezzo e chiusura di ieri). */
  dayEur: number
  dayPct: number | null
  unrealizedEur: number
  investedEur: number
  /** Plus meno minus realizzate nell'anno, e imposta stimata. */
  realizedYearEur: number
  taxYearEur: number
}

export function overviewKpis(rows: PositionRow[], totals: PortfolioTotals, lines: FiscalLine[], year: number): OverviewKpis {
  let dayEur = 0
  let base = 0
  for (const r of rows) {
    if (r.valueEur == null || r.dayChangePct == null) continue
    const size = Math.abs(r.valueEur)
    // dayChangePct è già col segno giusto anche per gli short (positivo = guadagno).
    const yesterday = size / (1 + (r.isShort ? -r.dayChangePct : r.dayChangePct) / 100)
    const change = r.isShort ? yesterday - size : size - yesterday
    dayEur += change
    base += yesterday
  }
  const inYear = lines.filter(l => l.year === year)
  return {
    valueEur: totals.valueEur,
    dayEur,
    dayPct: base > 0 ? (dayEur / base) * 100 : null,
    unrealizedEur: totals.unrealizedEur,
    investedEur: totals.investedEur,
    realizedYearEur: inYear.reduce((s, l) => s + l.gainEur, 0),
    taxYearEur: inYear.reduce((s, l) => s + l.taxEur, 0),
  }
}

/** Posizioni aperte più grandi (per valore), per il riquadro della Panoramica. */
export const topPositions = (rows: PositionRow[], n = 6) =>
  rows.filter(r => Math.abs(r.qty) > 1e-9).sort((a, b) => Math.abs(b.valueEur ?? 0) - Math.abs(a.valueEur ?? 0)).slice(0, n)
