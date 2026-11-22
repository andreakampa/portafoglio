import { describe, expect, it } from 'vitest'
import { buildAiContext } from './aiContext'
import { computePortfolio } from './engine/portfolio'
import { totals, valuePositions } from './engine/valuation'

describe('riassunto per l’assistente AI', () => {
  const portfolio = {
    name: 'Mario Rossi conto personale',
    taxRegime: 'dichiarativo',
    assets: {
      a: { ticker: 'NVDA', valuta: 'EUR', transactions: [{ id: '1', date: '2026-01-02', type: 'buy', qty: 10, price: 100 }, { id: '2', date: '2026-03-02', type: 'sell', qty: 4, price: 150 }] },
      b: { ticker: 'OLD', valuta: 'EUR', transactions: [{ id: '3', date: '2025-01-02', type: 'buy', qty: 1, price: 10 }, { id: '4', date: '2025-02-02', type: 'sell', qty: 1, price: 5 }] },
    },
  }

  it('posizioni aperte, fiscale dell’anno, movimenti recenti; niente nome del conto', () => {
    const result = computePortfolio(portfolio, () => 1)
    const rows = valuePositions(portfolio.assets, result.positions, { NVDA: { price: 120, previousClose: 118, currency: 'EUR' } }, {})
    const ctx = buildAiContext({ portfolio, result, rows, totals: totals(rows), today: '2026-11-22' })
    expect(ctx.regimeFiscale).toBe('dichiarativo')
    expect(ctx.posizioni).toEqual([expect.objectContaining({ titolo: 'NVDA', quantita: 6, prezzo: 120, valoreEur: 720 })])
    expect(ctx.fiscaleAnno).toMatchObject({ anno: 2026, plusEur: 200 })
    expect(ctx.ultimiMovimenti[0]).toMatchObject({ s: 'NVDA', d: '2026-03-02', t: 'sell' })
    const text = JSON.stringify(ctx)
    expect(text).not.toContain('Mario')
    expect(text.length).toBeLessThan(30000)
  })
})
