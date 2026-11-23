import { describe, expect, it } from 'vitest'
import { allPortfoliosGrossEur, allSymbols, grossValueEur, toDisplay, weights } from './display.ts'
import type { PortfolioResult, RawPortfolio } from './engine/portfolio.ts'
import type { PositionResult } from './engine/positions.ts'
import type { PositionRow } from './engine/valuation.ts'

const row = (assetId: string, qty: number, valueEur: number | null): PositionRow => ({
  assetId, symbol: assetId, currency: 'EUR', qty, isShort: qty < 0, pmcNative: 1, costEur: 1, costTodayFxEur: 1, price: 1,
  valueEur, unrealizedEur: 0, unrealizedPct: 0, dayChangePct: 0, realizedEur: 0,
})

describe('toDisplay', () => {
  it('lascia gli euro e converte in dollari col cambio', () => {
    expect(toDisplay(100, 'EUR', 1.08)).toBe(100)
    expect(toDisplay(100, 'USD', 1.08)).toBeCloseTo(108)
  })
  it('senza cambio o senza importo non inventa numeri', () => {
    expect(toDisplay(100, 'USD', null)).toBeNull()
    expect(toDisplay(null, 'EUR', 1.08)).toBeNull()
  })
})

describe('pesi', () => {
  const rows = [row('A', 10, 600), row('B', -5, -200), row('C', 0, null), row('D', 3, null), row('E', 0, 50)]
  it('base = valore lordo delle posizioni aperte con prezzo (short in valore assoluto)', () => {
    expect(grossValueEur(rows)).toBe(800)
  })
  it('peso di ogni titolo sulla base scelta', () => {
    const w = weights(rows, 800)
    expect(w.A).toBeCloseTo(75)
    expect(w.B).toBeCloseTo(25)
    expect(w.C).toBeUndefined()
    expect(w.D).toBeUndefined()
    expect(weights(rows, 1600).A).toBeCloseTo(37.5)
    expect(weights(rows, 0)).toEqual({})
  })
})

describe('tutti i portafogli', () => {
  const pos = (qty: number): PositionResult => ({
    qty, costNative: 0, costEur: 0, pmcNative: 0, pmcEur: 0, isShort: qty < 0, realized: [], realizedEur: 0, commissionsEur: 0, issues: [],
  })
  const portfolios = {
    p1: { assets: { a: { ticker: 'AAA', valuta: 'EUR' } } },
    p2: { assets: { b: { ticker: 'BBB', valuta: 'USD' }, c: { ticker: 'AAA', valuta: 'EUR' } } },
  } as unknown as Record<string, RawPortfolio>
  const results = {
    p1: { positions: { a: pos(10) } },
    p2: { positions: { b: pos(2), c: pos(1) } },
  } as unknown as Record<string, PortfolioResult>
  const quotes = { AAA: { price: 10, previousClose: null, currency: 'EUR' }, BBB: { price: 108, previousClose: null, currency: 'USD' } }

  it('simboli senza doppioni', () => {
    expect(allSymbols(portfolios).sort()).toEqual(['AAA', 'BBB'])
  })
  it('somma i valori di tutti i portafogli al cambio di oggi', () => {
    // 10×10 + 2×108/1,08 + 1×10 = 100 + 200 + 10
    expect(allPortfoliosGrossEur(portfolios, results, quotes, { USD: 1.08 })).toBeCloseTo(310)
  })
})
