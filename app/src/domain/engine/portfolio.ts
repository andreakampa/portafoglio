import { computeFiscal, type FiscalEventInput, type FiscalResult, type ManualLoss } from './fiscal.ts'
import { computePosition, methodFor, type PositionResult, type TransferPiece } from './positions.ts'
import type { CostMethod, FxLookup, Issue, RawAsset, TaxRegime } from './types.ts'

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

/** Come si calcola la posizione di un titolo: di norma `computePosition`, ma con i trasferimenti collegati tra portafogli. */
export type PositionFn = (assetId: string, asset: RawAsset, method: CostMethod) => PositionResult

/** Calcola posizioni e cassetto fiscale di un intero portafoglio. */
export function computePortfolio(p: RawPortfolio, fx: FxLookup, positionOf?: PositionFn): PortfolioResult {
  const regime: TaxRegime = p.taxRegime === 'dichiarativo' ? 'dichiarativo' : 'amministrato'
  const method = methodFor(regime)
  const positions: Record<string, PositionResult> = {}
  const events: FiscalEventInput[] = []
  const issues: PortfolioResult['issues'] = []

  for (const [assetId, asset] of Object.entries(p.assets ?? {})) {
    const pos = positionOf ? positionOf(assetId, asset, method) : computePosition(asset, method, fx)
    positions[assetId] = pos
    for (const e of pos.realized) {
      events.push({ ...e, assetId, assetName: asset.ticker || asset.nome || assetId, assetType: asset.tipoAsset || 'stock' })
    }
    for (const i of pos.issues) issues.push({ ...i, assetId })
  }

  return { regime, positions, fiscal: computeFiscal(events, p.fiscal?.manualLosses ?? [], regime), issues }
}

/**
 * Calcola tutti i portafogli insieme. I titoli trasferiti da un portafoglio all'altro (stesso `transferId`)
 * conservano il costo e la data degli acquisti originali, anche se il trasferimento è avvenuto in un altro giorno
 * e a un altro cambio. Se un trasferimento non si può collegare, quel titolo ricade sul vecchio calcolo
 * (prezzo indicato sul movimento, cambio del giorno) e compare un avviso.
 */
export function computeAllPortfolios(portfolios: Record<string, RawPortfolio>, fx: FxLookup): Record<string, PortfolioResult> {
  // Dove si trova l'uscita di ogni trasferimento.
  const outOf = new Map<string, { key: string; currency: string }>()
  for (const [pid, p] of Object.entries(portfolios)) {
    for (const [aid, a] of Object.entries(p.assets ?? {})) {
      for (const t of a.transactions ?? []) {
        if (t.type === 'transfer' && t.transferId && t.destPortfolioId) outOf.set(t.transferId, { key: `${pid}|${aid}`, currency: (a.valuta || 'EUR').toUpperCase() })
      }
    }
  }

  const assetByKey = (key: string) => {
    const [pid, aid] = key.split('|') as [string, string]
    return { pid, aid, asset: portfolios[pid]?.assets?.[aid] }
  }
  const pieces = new Map<string, TransferPiece[]>() // transferId → lotti usciti
  const done = new Map<string, PositionResult>()
  const busy = new Set<string>()

  const position = (key: string, method: CostMethod): PositionResult => {
    const hit = done.get(key)
    if (hit) return hit
    const { asset } = assetByKey(key)
    busy.add(key)
    const res = computePosition(asset ?? {}, method, fx, {
      incoming: (tx, currency) => {
        const src = tx.transferId ? outOf.get(tx.transferId) : undefined
        if (!src || src.currency !== currency) return undefined
        if (!pieces.has(tx.transferId!)) {
          if (busy.has(src.key)) return undefined // giro di trasferimenti A→B→A: si ricade sul calcolo semplice
          const { pid } = assetByKey(src.key)
          position(src.key, methodFor(portfolios[pid]?.taxRegime))
        }
        return pieces.get(tx.transferId!)
      },
      outgoing: (tx, ps) => void pieces.set(tx.transferId!, ps),
    })
    busy.delete(key)
    done.set(key, res)
    return res
  }

  const out: Record<string, PortfolioResult> = {}
  for (const [pid, p] of Object.entries(portfolios)) {
    out[pid] = computePortfolio(p, fx, (aid, _asset, method) => position(`${pid}|${aid}`, method))
  }
  return out
}
