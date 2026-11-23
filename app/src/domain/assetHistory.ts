// Storico di un titolo come nella finestra del sito vecchio (js/modules/portfolio/ui/history.js),
// con i numeri del motore nuovo: PMC dopo ogni movimento, cambio usato, plus/minus e imposta del cassetto.
import type { FiscalLine } from './engine/fiscal.ts'
import { buildMovements, type Movement } from './engine/movements.ts'
import type { PortfolioResult, RawPortfolio } from './engine/portfolio.ts'

export interface HistoryRow {
  m: Movement
  /** Prezzo in euro al cambio del giorno del movimento (null se manca il cambio). */
  priceEur: number | null
  /** Cambio usato (unità di valuta per 1 EUR); null per i titoli in euro. */
  rate: number | null
  /** Controvalore con le commissioni: speso (acquisti, ricoperture) o incassato (vendite, short), valuta del titolo. */
  totalNative: number
  /** Posizione dopo il movimento. */
  qtyAfter: number | null
  pmcNativeAfter: number | null
  pmcEurAfter: number | null
  /** Plus/minus (solo chiusure), imposta del cassetto e netto. */
  gainEur: number | null
  taxEur: number | null
  netEur: number | null
  /** Problemi trovati dal motore su questo movimento (triangolo di avviso). */
  issues: string[]
}

export interface HistorySummary {
  qty: number
  pmcNative: number
  pmcEur: number
  realizedEur: number
  realizedNetEur: number
  commissionsEur: number
  pac: boolean
}

const SPEND = new Set(['buy', 'buy_to_cover'])

export function assetHistory(portfolio: RawPortfolio, result: PortfolioResult, assetId: string): { rows: HistoryRow[]; summary: HistorySummary } {
  const asset = portfolio.assets?.[assetId]
  const pos = result.positions[assetId]
  const one: RawPortfolio = { ...portfolio, assets: asset ? { [assetId]: asset } : {} }
  const moves = buildMovements(one, result)
  const steps = new Map((pos?.steps ?? []).map(s => [s.index, s]))
  const lines = result.fiscal.lines.filter(l => l.assetId === assetId)
  const lineOf = (txId?: string): FiscalLine | undefined => (txId ? lines.find(l => l.key.startsWith(`${assetId}#${txId}#`)) : undefined)
  const issuesOf = (txId?: string) => (txId ? (pos?.issues ?? []).filter(i => i.txId === txId).map(i => i.message) : [])

  const rows = moves.map((m): HistoryRow => {
    const s = steps.get(m.index)
    const rate = m.currency === 'EUR' ? null : s && Number.isFinite(s.rate) && s.rate > 0 ? s.rate : null
    const commNative = m.commissionCurrency === m.currency ? m.commission : rate ? m.commission * rate : m.commissionCurrency === 'EUR' && m.currency === 'EUR' ? m.commission : 0
    const totalNative = SPEND.has(m.kind) ? m.gross + commNative : m.gross - commNative
    const line = lineOf(m.txId)
    const taxEur = m.gainEur === null ? null : line?.taxEur ?? 0
    return {
      m,
      priceEur: m.currency === 'EUR' ? m.price : rate ? m.price / rate : null,
      rate,
      totalNative,
      qtyAfter: s ? s.qty : null,
      pmcNativeAfter: s ? s.pmcNative : null,
      pmcEurAfter: s ? s.pmcEur : null,
      gainEur: m.gainEur,
      taxEur,
      netEur: m.gainEur === null ? null : m.gainEur - (taxEur ?? 0),
      issues: issuesOf(m.txId),
    }
  })

  const realizedEur = pos?.realizedEur ?? 0
  return {
    rows,
    summary: {
      qty: pos?.qty ?? 0,
      pmcNative: pos?.pmcNative ?? 0,
      pmcEur: pos?.pmcEur ?? 0,
      realizedEur,
      realizedNetEur: realizedEur - lines.filter(l => l.side !== 'manuale').reduce((s, l) => s + l.taxEur, 0),
      commissionsEur: pos?.commissionsEur ?? 0,
      pac: moves.some(m => m.pac),
    },
  }
}
