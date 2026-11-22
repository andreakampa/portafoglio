import { describe, expect, it } from 'vitest'
import { buildHistory, indexReturn, rebase } from './history.ts'

describe('storico del portafoglio', () => {
  const closes = { X: { '2026-01-02': 10, '2026-01-05': 11, '2026-01-06': 12, '2026-01-07': 12 } }

  it('valore, investito e rendimento che non conta i versamenti', () => {
    const h = buildHistory({
      assets: [{ symbol: 'X', currency: 'EUR', transactions: [
        { date: '2026-01-02', type: 'buy', qty: 10, price: 10 },
        { date: '2026-01-06', type: 'buy', qty: 10, price: 12 },
      ] }],
      closes, fx: {}, to: '2026-01-07',
    })
    expect(h.points.map(p => [p.date, p.valueEur, p.investedEur])).toEqual([
      ['2026-01-02', 100, 100], ['2026-01-05', 110, 100], ['2026-01-06', 240, 220], ['2026-01-07', 240, 220],
    ])
    // +10% poi +9,09%: il secondo acquisto non è un guadagno.
    expect(h.points.at(-1)!.twrPct).toBeCloseTo(20)
  })

  it('valute convertite col cambio del giorno (o l’ultimo noto) e short in negativo', () => {
    const h = buildHistory({
      assets: [{ symbol: 'X', currency: 'USD', transactions: [{ date: '2026-01-02', type: 'short_sell', qty: 1, price: 10 }] }],
      closes, fx: { USD: { '2026-01-02': 1.25 } }, to: '2026-01-05',
    })
    expect(h.points.map(p => p.valueEur)).toEqual([-8, -8.8])
    expect(h.points[1]!.twrPct).toBeLessThan(0)
  })

  it('titolo senza chiusure: valutato al prezzo del movimento e segnalato', () => {
    const h = buildHistory({ assets: [{ symbol: 'Y', currency: 'EUR', transactions: [{ date: '2026-01-05', type: 'buy', qty: 2, price: 5 }] }], closes, fx: {}, to: '2026-01-07' })
    expect(h.missing).toEqual(['Y'])
    expect(h.points[0]).toMatchObject({ date: '2026-01-05', valueEur: 10 })
  })

  it('trasferimento in entrata: è un versamento al valore di mercato', () => {
    const h = buildHistory({ assets: [{ symbol: 'X', currency: 'EUR', transactions: [{ date: '2026-01-05', type: 'transfer', qty: 5, price: 3, sourcePortfolioId: 'A' }] }], closes, fx: {}, to: '2026-01-06' })
    expect(h.points.map(p => [p.valueEur, p.investedEur])).toEqual([[55, 55], [60, 55]])
    expect(h.points[1]!.twrPct).toBeCloseTo((60 / 55 - 1) * 100)
  })

  it('indici in euro e rendimento ribasato all’inizio del periodo', () => {
    const r = indexReturn({ '2026-01-02': 100, '2026-01-05': 110 }, '2026-01-01', '2026-01-31', { '2026-01-02': 1, '2026-01-05': 1.1 })
    expect(r[1]!.pct).toBeCloseTo(0)
    expect(rebase([{ date: 'a', valueEur: 0, investedEur: 0, twrPct: 10 }, { date: 'b', valueEur: 0, investedEur: 0, twrPct: 21 }], 'a').map(p => Math.round(p.pct * 100) / 100)).toEqual([0, 10])
  })
})
