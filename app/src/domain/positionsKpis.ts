// Numeri chiave della pagina Posizioni, in due gruppi come nel sito vecchio (Portafoglio e Performance).
// Funzione pura: usa i risultati del motore nuovo (costi e cassetto con i cambi storici).
import type { DividendRow } from './engine/dividends.ts'
import { taxRateFor, type FiscalLine } from './engine/fiscal.ts'
import type { MarginInterestRow } from './engine/movements.ts'
import type { PositionResult } from './engine/positions.ts'
import type { AssetType } from './engine/types.ts'
import type { PositionRow } from './engine/valuation.ts'

export interface PositionsKpis {
  // Portafoglio
  /** Costo dei titoli long aperti al cambio di oggi (come lo mostra il broker). */
  investedEur: number
  valueEur: number
  commissionsEur: number
  /** Interessi di margine addebitati da sempre, al cambio di oggi; null se il conto non ne ha. */
  marginInterestEur: number | null
  /** Dividendi incassati (lordo meno ritenuta estera) e lordo. */
  dividendsReceivedEur: number
  dividendsGrossEur: number
  /** Imposta stimata sulle plus realizzate nell'anno. */
  taxYearEur: number
  // Performance
  /** Non realizzato al cambio di oggi (vista broker) e in % sull'investito. */
  unrealizedEur: number
  unrealizedPct: number | null
  /** Imposta che si pagherebbe vendendo tutto oggi (dal simulatore: perdite e minus del cassetto compensano). */
  unrealizedTaxEur: number
  afterTaxEur: number
  afterTaxPct: number | null
  /** Realizzato da sempre: lordo e al netto dell'imposta del cassetto. */
  realizedGrossEur: number
  realizedNetEur: number
  /** Realizzato netto + non realizzato netto. */
  totalAfterTaxEur: number
  /** Non realizzato fiscale: costo con il cambio del giorno di ogni acquisto (Banca d'Italia). */
  historicEur: number
  historicPct: number | null
}

const pctOf = (x: number, base: number) => (base > 0 ? (x / base) * 100 : null)

export function positionsKpis(input: {
  rows: PositionRow[]
  positions: Record<string, PositionResult>
  assetTypes: Record<string, AssetType | undefined>
  lines: FiscalLine[]
  marginInterest: MarginInterestRow[]
  dividends: DividendRow[]
  latestFx: Record<string, number>
  year: number
  /** Imposta di uscita calcolata dal simulatore; se manca, stima titolo per titolo sui soli guadagni. */
  exitTaxEur?: number | null
}): PositionsKpis {
  const { rows, positions, assetTypes, lines, marginInterest, dividends, latestFx, year } = input
  let investedEur = 0
  let valueEur = 0
  let unrealizedEur = 0
  let historicEur = 0
  let historicCostEur = 0
  let unrealizedTaxEur = 0
  for (const r of rows) {
    if (r.qty === 0 || r.valueEur === null || r.unrealizedEur === null || r.costTodayFxEur === null) continue
    const marketEur = Math.abs(r.valueEur)
    const todayGain = r.isShort ? r.costTodayFxEur - marketEur : marketEur - r.costTodayFxEur
    if (!r.isShort) {
      investedEur += r.costTodayFxEur
      historicCostEur += r.costEur
      valueEur += marketEur
    } else {
      valueEur += todayGain
    }
    unrealizedEur += todayGain
    historicEur += r.unrealizedEur
    if (r.unrealizedEur > 0) unrealizedTaxEur += r.unrealizedEur * taxRateFor(assetTypes[r.assetId])
  }

  const commissionsEur = Object.values(positions).reduce((s, p) => s + (p.commissionsEur || 0), 0)

  let marginInterestEur: number | null = null
  for (const m of marginInterest) {
    const rate = m.currency === 'EUR' ? 1 : latestFx[m.currency]
    if (!rate) continue
    marginInterestEur = (marginInterestEur ?? 0) + Math.abs(m.amount) / rate
  }

  const dividendsGrossEur = dividends.reduce((s, d) => s + d.grossEur, 0)
  const dividendsReceivedEur = dividends.reduce((s, d) => s + d.grossEur - d.withholdingEur, 0)

  const real = lines.filter(l => l.side !== 'manuale')
  const realizedGrossEur = real.reduce((s, l) => s + l.gainEur, 0)
  const realizedNetEur = realizedGrossEur - real.reduce((s, l) => s + l.taxEur, 0)
  const taxYearEur = lines.filter(l => l.year === year).reduce((s, l) => s + l.taxEur, 0)
  if (input.exitTaxEur != null) unrealizedTaxEur = input.exitTaxEur
  const afterTaxEur = unrealizedEur - unrealizedTaxEur

  return {
    investedEur,
    valueEur,
    commissionsEur,
    marginInterestEur,
    dividendsReceivedEur,
    dividendsGrossEur,
    taxYearEur,
    unrealizedEur,
    unrealizedPct: pctOf(unrealizedEur, investedEur),
    unrealizedTaxEur,
    afterTaxEur,
    afterTaxPct: pctOf(afterTaxEur, investedEur),
    realizedGrossEur,
    realizedNetEur,
    totalAfterTaxEur: realizedNetEur + afterTaxEur,
    historicEur,
    historicPct: pctOf(historicEur, historicCostEur),
  }
}
