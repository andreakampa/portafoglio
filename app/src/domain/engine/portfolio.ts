import { computeFiscal, type FiscalEventInput, type FiscalResult, type ManualLoss } from './fiscal.ts'
import { computePosition, methodFor, type PositionResult } from './positions.ts'
import type { FxLookup, Issue, RawAsset, TaxRegime } from './types.ts'

export interface RawPortfolio {
  id?: string
  name?: string
  taxRegime?: TaxRegime | string
  assets?: Record<string, RawAsset>
  fiscal?: { manualLosses?: ManualLoss[] }
}

export interface PortfolioResult {
  regime: TaxRegime
  positions: Record<string, PositionResult>
  fiscal: FiscalResult
  issues: (Issue & { assetId: string })[]
}

/** Calcola posizioni e cassetto fiscale di un intero portafoglio. */
export function computePortfolio(p: RawPortfolio, fx: FxLookup): PortfolioResult {
  const regime: TaxRegime = p.taxRegime === 'dichiarativo' ? 'dichiarativo' : 'amministrato'
  const method = methodFor(regime)
  const positions: Record<string, PositionResult> = {}
  const events: FiscalEventInput[] = []
  const issues: PortfolioResult['issues'] = []

  for (const [assetId, asset] of Object.entries(p.assets ?? {})) {
    const pos = computePosition(asset, method, fx)
    positions[assetId] = pos
    for (const e of pos.realized) {
      events.push({ ...e, assetId, assetName: asset.ticker || asset.nome || assetId, assetType: asset.tipoAsset || 'stock' })
    }
    for (const i of pos.issues) issues.push({ ...i, assetId })
  }

  return { regime, positions, fiscal: computeFiscal(events, p.fiscal?.manualLosses ?? [], regime), issues }
}
