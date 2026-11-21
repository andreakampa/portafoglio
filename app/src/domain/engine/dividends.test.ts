import { describe, expect, it } from 'vitest'
import { dividendsFromCashflows, estimateDividends, qtyBefore, summarizeDividends } from './dividends.ts'

const fx = (c: string) => (c === 'USD' ? 1.25 : undefined)

describe('qtyBefore', () => {
  const txs = [
    { date: '2026-01-10', type: 'buy', qty: 10, price: 1 },
    { date: '2026-02-10', type: 'sell', qty: 4, price: 1 },
    { date: '2026-03-10', type: 'transfer', qty: 2, price: 1, sourcePortfolioId: 'x' },
    { date: '2026-04-10', type: 'transfer', qty: 1, price: 1, destPortfolioId: 'y' },
  ]
  it('conta solo i movimenti prima dello stacco', () => {
    expect(qtyBefore(txs, '2026-01-10')).toBe(0)
    expect(qtyBefore(txs, '2026-01-11')).toBe(10)
    expect(qtyBefore(txs, '2026-03-20')).toBe(8)
    expect(qtyBefore(txs, '2026-12-01')).toBe(7)
  })
})

describe('estimateDividends', () => {
  const asset = { ticker: 'AAA', valuta: 'USD', transactions: [{ date: '2026-01-01', type: 'buy', qty: 100, price: 10 }] }
  const yahoo = [{ exDate: '2025-12-01', amount: 1 }, { exDate: '2026-05-01', amount: 0.5 }, { exDate: '2099-01-01', amount: 1 }]
  it('dichiarativo: 26% sul lordo, ritenuta USA 15% non sottratta', () => {
    const [r, ...rest] = estimateDividends('a', asset, yahoo, 'dichiarativo', fx, '2026-11-21')
    expect(rest).toHaveLength(0) // prima dell'acquisto e futuro esclusi
    expect(r!.grossEur).toBeCloseTo(40) // 100 × 0,5 / 1,25
    expect(r!.withholdingEur).toBeCloseTo(6)
    expect(r!.taxEur).toBeCloseTo(10.4)
    expect(r!.netEur).toBeCloseTo(34)
  })
  it('amministrato: 26% sul netto della ritenuta, netto già al netto di tutto', () => {
    const [r] = estimateDividends('a', asset, yahoo, 'amministrato', fx, '2026-11-21')
    expect(r!.taxEur).toBeCloseTo(8.84) // 26% di 34
    expect(r!.netEur).toBeCloseTo(25.16)
  })
  it('salta le date senza cambio', () => {
    expect(estimateDividends('a', { ...asset, valuta: 'CAD' }, yahoo, 'dichiarativo', fx, '2026-11-21')).toEqual([])
  })
})

describe('dividendsFromCashflows', () => {
  const flows = [
    { date: '2026-03-01', kind: 'dividend', symbol: 'AAA', currency: 'USD', amount: 100, exchangeRate: 1.25 },
    { date: '2026-03-01', kind: 'withholding', symbol: 'AAA', currency: 'USD', amount: -15, exchangeRate: 1.25 },
    { date: '2026-03-02', kind: 'fee', symbol: '', currency: 'EUR', amount: -1 },
    { date: '2025-06-01', kind: 'dividend', symbol: 'BBB', currency: 'EUR', amount: 10 },
  ]
  it('unisce dividendo e ritenuta, ignora gli altri tipi', () => {
    const rows = dividendsFromCashflows(flows, 'dichiarativo', fx)
    expect(rows).toHaveLength(2)
    const a = rows.find(r => r.symbol === 'AAA')!
    expect(a.grossEur).toBeCloseTo(80)
    expect(a.withholdingEur).toBeCloseTo(12)
    expect(a.taxEur).toBeCloseTo(20.8)
    expect(a.source).toBe('ibkr')
  })
  it('somma per anno', () => {
    const years = summarizeDividends(dividendsFromCashflows(flows, 'dichiarativo', fx))
    expect(years.map(y => y.year)).toEqual([2026, 2025])
    expect(years[0]!.netEur).toBeCloseTo(68)
    expect(years[1]!.grossEur).toBeCloseTo(10)
  })
})
