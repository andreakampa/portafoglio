import { describe, expect, it } from 'vitest'
import { leverageAlert, marginOnDate, summarizeMargin, type MarginPortfolio } from './margin'
import type { PositionRow } from './valuation'

const row = (valueEur: number | null, qty = 1): PositionRow => ({
  assetId: 'a', symbol: 'X', currency: 'EUR', qty, isShort: (valueEur ?? 0) < 0, pmcNative: 0, costEur: 0, costTodayFxEur: 0, price: 1,
  valueEur, unrealizedEur: 0, unrealizedPct: 0, dayChangePct: 0, realizedEur: 0,
})

const p: MarginPortfolio = {
  marginStatus: {
    date: '2026-11-19',
    baseCurrency: 'EUR',
    baseCash: -9000,
    balances: [
      { currency: 'USD', endingCash: -10080, accrued: -50, ratePct: 5.4 },
      { currency: 'EUR', endingCash: 1000, accrued: -2, ratePct: null },
    ],
  },
  marginInterest: [
    { period: '2026-10', currency: 'USD', amount: 44.8 },
    { period: '2026-09', currency: 'EUR', amount: 3 },
    { period: '2025-12', currency: 'EUR', amount: 99 },
  ] as MarginPortfolio['marginInterest'],
}
const fx = { USD: 1.12 }

describe('margine', () => {
  const m = summarizeMargin(p, [row(60000), row(-1000), row(null)], fx, 2026)!

  it('margine usato = debito netto in euro del report', () => {
    expect(m.usedEur).toBe(9000)
    expect(m.date).toBe('2026-11-19')
    expect(m.balances[0]!.debtEur).toBe(9000) // 10080 USD / 1,12
  })

  it('leva = esposizione lorda (long + |short|) / patrimonio netto', () => {
    expect(m.grossEur).toBe(61000)
    expect(m.equityEur).toBe(50000) // 60000 - 1000 - 9000
    expect(m.leverage).toBe(1.22)
    expect(m.missingPrices).toBe(1)
  })

  it('costo stimato col tasso attuale su 360 giorni', () => {
    expect(m.dailyCostEur).toBe(1.35) // 9000 × 5,4% / 360
    expect(m.monthlyCostEur).toBe(41.06)
  })

  it('interessi pagati nell’anno in euro e maturati non addebitati', () => {
    expect(m.paidYearEur).toBe(43) // 44,8/1,12 + 3, non il 2025
    expect(m.accruedEur).toBe(46.64) // 50/1,12 + 2
  })

  it('senza debito netto il margine usato è zero e la leva resta calcolata', () => {
    const q = summarizeMargin({ marginStatus: { ...p.marginStatus!, baseCash: 500 } }, [row(10000)], fx, 2026)!
    expect(q.usedEur).toBe(0)
    expect(q.leverage).toBe(0.952)
  })

  it('segnala le valute a debito senza tasso o cambio e non inventa il costo', () => {
    const q = summarizeMargin(p, [row(60000)], {}, 2026)!
    expect(q.incomplete).toEqual(['USD'])
    expect(q.dailyCostEur).toBe(0)
  })

  it('una valuta senza tasso salvata da Firebase (campo assente) non rompe il costo', () => {
    const { ratePct: _drop, ...noRate } = p.marginStatus!.balances[1]!
    const q = summarizeMargin({ marginStatus: { ...p.marginStatus!, balances: [p.marginStatus!.balances[0]!, { ...noRate, endingCash: -300 } as never] } }, [row(60000)], fx, 2026)!
    expect(q.dailyCostEur).toBe(1.35)
    expect(q.incomplete).toEqual(['EUR'])
  })

  it('senza foto del margine non c’è riassunto', () => {
    expect(summarizeMargin({}, [], fx, 2026)).toBeNull()
  })
})

describe('avviso leva', () => {
  it('confronta la leva con la soglia', () => {
    expect(leverageAlert(1.5, 1.4)).toBe('over')
    expect(leverageAlert(1.3, 1.4)).toBe('near')
    expect(leverageAlert(1.1, 1.4)).toBe('ok')
    expect(leverageAlert(1.5, null)).toBe('none')
    expect(leverageAlert(null, 1.4)).toBe('none')
  })
})

describe('margine nel giorno di un acquisto', () => {
  const q: MarginPortfolio = {
    marginDaily: [
      { date: '2026-11-18', currency: 'USD', principal: -10171.68, ratePct: 5.38, interest: -1.52 },
      { date: '2026-11-18', currency: 'CAD', principal: -600, ratePct: 5, interest: -0.08 },
    ],
  }
  it('mostra i debiti del giorno', () => {
    expect(marginOnDate(q, '2026-11-18')!.debts.map(d => d.currency)).toEqual(['USD', 'CAD'])
  })
  it('usa l’ultimo giorno noto entro 5 giorni (weekend)', () => {
    expect(marginOnDate(q, '2026-11-21')!.date).toBe('2026-11-18')
  })
  it('prima dello storico non inventa niente', () => {
    expect(marginOnDate(q, '2026-10-01')).toBeNull()
    expect(marginOnDate({}, '2026-11-18')).toBeNull()
  })
  it('dove il report copre il periodo ma non ci sono righe di debito, il conto era senza margine', () => {
    const covered = { ...q, marginHistoryFrom: '2026-01-01' }
    expect(marginOnDate(covered, '2026-03-10')).toEqual({ date: '2026-03-10', debts: [] })
    expect(marginOnDate(covered, '2026-12-01')!.debts).toEqual([])
    expect(marginOnDate(covered, '2025-12-31')).toBeNull()
  })
})
