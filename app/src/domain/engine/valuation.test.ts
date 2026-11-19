import { describe, expect, it } from 'vitest'
import { computePosition } from './positions.ts'
import { totals, valuePositions } from './valuation.ts'
import type { RawAsset } from './types.ts'

const noFx = () => undefined

describe('valorizzazione', () => {
  const assets: Record<string, RawAsset> = {
    a: { ticker: 'AAA', valuta: 'USD', transactions: [{ date: '2026-01-01', type: 'buy', qty: 10, price: 100, exchangeRate: 1.25 }] },
    s: { ticker: 'SSS', valuta: 'EUR', transactions: [{ date: '2026-01-01', type: 'short_sell', qty: 5, price: 20 }] },
    x: { ticker: 'XXX', valuta: 'EUR', transactions: [{ date: '2026-01-01', type: 'buy', qty: 1, price: 50 }] },
  }
  const positions = Object.fromEntries(Object.entries(assets).map(([id, a]) => [id, computePosition(a, 'average', noFx)]))
  const quotes = {
    AAA: { price: 110, previousClose: 100, currency: 'USD' },
    SSS: { price: 16, previousClose: 20, currency: 'EUR' },
  }
  const rows = valuePositions(assets, positions, quotes, { USD: 1.1 })

  it('long in dollari: valore e risultato in EUR al cambio di oggi', () => {
    const r = rows.find(r => r.symbol === 'AAA')!
    expect(r.valueEur).toBeCloseTo(1000, 8) // 1100 USD / 1,1
    expect(r.unrealizedEur).toBeCloseTo(200, 8) // costo 800 €
    expect(r.unrealizedPct).toBeCloseTo(25, 8)
    expect(r.dayChangePct).toBeCloseTo(10, 8)
  })

  it('short: guadagna se il prezzo scende', () => {
    const r = rows.find(r => r.symbol === 'SSS')!
    expect(r.unrealizedEur).toBeCloseTo(100 - 80, 8)
    expect(r.dayChangePct).toBeCloseTo(20, 8)
  })

  it('senza prezzo il valore resta vuoto', () => {
    expect(rows.find(r => r.symbol === 'XXX')!.valueEur).toBeNull()
  })

  it('totali: lo short non conta come investito, i titoli senza prezzo sono esclusi e contati', () => {
    const t = totals(rows)
    expect(t.investedEur).toBeCloseTo(800, 8)
    expect(t.unrealizedEur).toBeCloseTo(220, 8)
    expect(t.valueEur).toBeCloseTo(1020, 8)
    expect(t.missingPrices).toBe(1)
  })
})
