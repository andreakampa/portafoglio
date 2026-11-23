import { describe, expect, it } from 'vitest'
import { computePortfolio, type RawPortfolio } from './engine/portfolio'
import { buildMovements } from './engine/movements'
import { buildInterest, customRange, isManualInterest, periodTotals, taxByMovement, validateInterest } from './movementsView'

const p: RawPortfolio = {
  taxRegime: 'amministrato',
  assets: {
    x: {
      ticker: 'XXX', valuta: 'EUR', tipoAsset: 'stock',
      transactions: [
        { id: 'b', date: '2026-01-10', type: 'buy', qty: 10, price: 100 },
        { id: 'l', date: '2026-02-01', type: 'sell', qty: 2, price: 50 }, // minus 100
        { id: 'g', date: '2026-03-01', type: 'sell', qty: 4, price: 200 }, // plus 400, ne compensa 100
      ],
    },
  },
}

describe('pagina Movimenti', () => {
  it('periodo dal/al con estremi compresi, anche invertiti', () => {
    expect(customRange('2026-01-01', '2026-03-31')).toEqual(['2026-01-01', '2026-04-01'])
    expect(customRange('2026-03-31', '2026-01-01')).toEqual(['2026-01-01', '2026-04-01'])
    expect(customRange('', '2026-12-31')).toEqual(['0000-01-01', '2027-01-01'])
  })

  it('imposta per movimento dal cassetto fiscale e totali del periodo', () => {
    const r = computePortfolio(p, () => undefined)
    const list = buildMovements(p, r)
    const tax = taxByMovement(r.fiscal.lines, list)
    const g = list.find(m => m.txId === 'g')!
    expect(tax.get(g.key)).toBeCloseTo(300 * 0.26, 8)
    expect(tax.get(list.find(m => m.txId === 'l')!.key)).toBe(0)
    expect(tax.has(list.find(m => m.txId === 'b')!.key)).toBe(false)
    const t = periodTotals(list, tax)
    expect(t.plus).toBeCloseTo(400, 8)
    expect(t.minus).toBeCloseTo(-100, 8)
    expect(t.tax).toBeCloseTo(78, 8)
  })

  it('interessi di margine a mano: controlli e forma del sito vecchio', () => {
    expect(validateInterest({ period: '2026-10', amount: '4,5', currency: 'usd' }, '2026-11-24')).toBeNull()
    expect(validateInterest({ period: '2026-12', amount: '4', currency: 'USD' }, '2026-11-24')).toMatch(/futuro/)
    expect(validateInterest({ period: '2026-10', amount: '0', currency: 'USD' }, '2026-11-24')).toMatch(/importo/)
    expect(buildInterest({ period: '2026-10', amount: '4,5', currency: 'usd' }, '1')).toEqual({ id: 'MI1', period: '2026-10', currency: 'USD', amount: 4.5 })
    expect(isManualInterest({ period: '2026-10', currency: 'USD', amount: 1 })).toBe(true)
    expect(isManualInterest({ period: '2026-10', currency: 'USD', amount: 1, externalId: 'MI:2026-10:USD', source: 'ibkr' })).toBe(false)
  })
})
