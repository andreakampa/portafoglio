import type { PositionResult } from './positions.ts'
import type { RawAsset } from './types.ts'

export interface QuoteLike {
  price: number
  previousClose: number | null
  currency: string
}

export interface PositionRow {
  assetId: string
  symbol: string
  currency: string
  qty: number
  isShort: boolean
  pmcNative: number
  costEur: number
  /** Costo nella valuta del titolo convertito al cambio di OGGI (vista del broker); null senza cambio. */
  costTodayFxEur: number | null
  price: number | null
  /** Chiusura di ieri, nella valuta del titolo. */
  previousClose?: number | null
  valueEur: number | null
  /** Risultato non realizzato in EUR (al cambio di oggi), positivo = guadagno anche per gli short. */
  unrealizedEur: number | null
  unrealizedPct: number | null
  dayChangePct: number | null
  realizedEur: number
}

export const symbolOf = (a: RawAsset, fallback: string) => (a.ticker || a.nome || fallback).trim()

/**
 * Valorizza le posizioni ai prezzi attuali. `latestFx` = unità di valuta per 1 EUR oggi.
 * Senza prezzo o senza cambio il valore resta null: meglio un vuoto che un numero sbagliato.
 */
export function valuePositions(
  assets: Record<string, RawAsset>,
  positions: Record<string, PositionResult>,
  quotes: Record<string, QuoteLike>,
  latestFx: Record<string, number>,
): PositionRow[] {
  const rows: PositionRow[] = []
  for (const [assetId, asset] of Object.entries(assets)) {
    const pos = positions[assetId]
    if (!pos) continue
    const symbol = symbolOf(asset, assetId)
    const q = quotes[symbol]
    const currency = (q?.currency || asset.valuta || 'EUR').toUpperCase()
    const rate = currency === 'EUR' ? 1 : latestFx[currency]
    const absQty = Math.abs(pos.qty)

    let valueEur: number | null = null
    let unrealizedEur: number | null = null
    if (q && rate && absQty > 0) {
      const marketEur = (absQty * q.price) / rate
      valueEur = pos.isShort ? -marketEur : marketEur
      unrealizedEur = pos.isShort ? pos.costEur - marketEur : marketEur - pos.costEur
    }
    const dayChangePct = q?.previousClose ? ((q.price - q.previousClose) / q.previousClose) * 100 * (pos.isShort ? -1 : 1) : null

    rows.push({
      assetId,
      symbol,
      currency,
      qty: pos.qty,
      isShort: pos.isShort,
      pmcNative: pos.pmcNative,
      costEur: pos.costEur,
      costTodayFxEur: rate ? pos.costNative / rate : null,
      price: q?.price ?? null,
      previousClose: q?.previousClose ?? null,
      valueEur,
      unrealizedEur,
      unrealizedPct: unrealizedEur !== null && pos.costEur > 0 ? (unrealizedEur / pos.costEur) * 100 : null,
      dayChangePct,
      realizedEur: pos.realizedEur,
    })
  }
  return rows
}

export interface PortfolioTotals {
  investedEur: number
  valueEur: number
  unrealizedEur: number
  /** Titoli aperti senza prezzo: i totali li escludono. */
  missingPrices: number
}

export function totals(rows: PositionRow[]): PortfolioTotals {
  let investedEur = 0
  let valueEur = 0
  let unrealizedEur = 0
  let missingPrices = 0
  for (const r of rows) {
    if (r.qty === 0) continue
    if (r.valueEur === null || r.unrealizedEur === null) {
      missingPrices++
      continue
    }
    // Lo short non è un investimento: incide solo con il suo risultato.
    if (!r.isShort) {
      investedEur += r.costEur
      valueEur += r.valueEur
    } else {
      valueEur += r.unrealizedEur
    }
    unrealizedEur += r.unrealizedEur
  }
  return { investedEur, valueEur, unrealizedEur, missingPrices }
}
