import { describe, expect, it } from 'vitest'
import { overviewKpis, topPositions } from './overview'
import type { PositionRow } from './engine/valuation'

const row = (p: Partial<PositionRow>): PositionRow => ({
  assetId: 'a', symbol: 'A', currency: 'EUR', qty: 1, isShort: false, pmcNative: 1, costEur: 100, costTodayFxEur: 100, price: 1,
  valueEur: 110, unrealizedEur: 10, unrealizedPct: 10, dayChangePct: 10, realizedEur: 0, ...p,
})

describe('numeri della Panoramica', () => {
  it('variazione di oggi da prezzi e chiusura di ieri, anche con gli short', () => {
    const k = overviewKpis(
      [row({}), row({ assetId: 'b', isShort: true, valueEur: -90, dayChangePct: 10 }), row({ assetId: 'c', dayChangePct: null })],
      { valueEur: 130, investedEur: 200, unrealizedEur: -5, missingPrices: 0 },
      [{ year: 2026, gainEur: 50, taxEur: 13 } as never, { year: 2025, gainEur: 999, taxEur: 1 } as never],
      2026,
    )
    // Long: 100 → 110 (+10). Short: il prezzo è sceso del 10% (da 100 a 90): +10 per chi è short.
    expect(k.dayEur).toBeCloseTo(20)
    expect(k.dayPct).toBeCloseTo(10)
    expect(k).toMatchObject({ valueEur: 130, realizedYearEur: 50, taxYearEur: 13 })
  })

  it('posizioni più grandi, senza quelle chiuse', () => {
    const t = topPositions([row({ assetId: 'x', valueEur: 5 }), row({ assetId: 'y', valueEur: -50, isShort: true }), row({ assetId: 'z', qty: 0, valueEur: 0 })], 2)
    expect(t.map(r => r.assetId)).toEqual(['y', 'x'])
  })
})
