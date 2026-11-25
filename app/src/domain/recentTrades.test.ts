import { describe, expect, it } from 'vitest'
import type { RawPortfolio } from './engine/portfolio'
import { inWindow, recentTotals, recentTrades, windowStart } from './recentTrades'

const fx = (cur: string) => (cur === 'USD' ? 1.25 : undefined)
const TODAY = '2026-11-23' // lunedì

const p = (assets: RawPortfolio['assets']): RawPortfolio => ({ name: 'Prova', assets }) as RawPortfolio

describe('operazioni recenti', () => {
  it('periodo in giorni di calendario: di lunedì 3 giorni arrivano al venerdì', () => {
    expect(windowStart(TODAY, 1)).toBe('2026-11-22')
    expect(windowStart(TODAY, 3)).toBe('2026-11-20')
    expect(windowStart('2026-03-02', 7)).toBe('2026-02-23')
  })

  it('costo al cambio del giorno, valore e variazione al prezzo e cambio di oggi', () => {
    const list = recentTrades(
      p({ n: { ticker: 'NVDA', valuta: 'USD', transactions: [{ id: 't1', date: '2026-11-23', type: 'buy', qty: 10, price: 100, commission: 2 }] } }),
      fx, { NVDA: { price: 110, currency: 'USD' } }, { USD: 1.1 }, TODAY,
    )
    expect(list).toHaveLength(1)
    const t = list[0]!
    expect(t.costEur).toBeCloseTo(802) // 1000 $ / 1,25 + 2 € di commissione
    expect(t.valueEur).toBeCloseTo(1000) // 1100 $ / 1,1
    expect(t.unrealizedEur).toBeCloseTo(198)
    expect(t.unrealizedPct).toBeCloseTo((198 / 802) * 100)
  })

  it('short: guadagno quando il prezzo scende', () => {
    const t = recentTrades(
      p({ s: { ticker: 'TSLA', valuta: 'EUR', transactions: [{ id: 's1', date: '2026-11-20', type: 'short_sell', qty: 5, price: 100, commission: 1 }] } }),
      fx, { TSLA: { price: 90 } }, {}, TODAY,
    )[0]!
    expect(t.costEur).toBeCloseTo(499) // incassati, al netto della commissione
    expect(t.unrealizedEur).toBeCloseTo(49)
  })

  it('oltre 7 giorni, vendite, trasferimenti e date future restano fuori', () => {
    const list = recentTrades(
      p({ a: { ticker: 'A', transactions: [
        { date: '2026-11-15', type: 'buy', qty: 1, price: 10 },
        { date: '2026-11-16', type: 'buy', qty: 1, price: 10 },
        { date: '2026-11-24', type: 'buy', qty: 1, price: 10 },
        { date: '2026-11-21', type: 'transfer', qty: 1, price: 10 },
      ] } }),
      fx, { A: { price: 10 } }, {}, TODAY,
    )
    expect(list.map(t => t.date)).toEqual(['2026-11-16'])
  })

  it('comprata e rivenduta nella settimana: risultato incassato, fuori dal non realizzato', () => {
    const list = recentTrades(
      p({ a: { ticker: 'A', transactions: [
        { id: 'b1', date: '2026-11-17', type: 'buy', qty: 10, price: 10 },
        { id: 'b2', date: '2026-11-18', type: 'buy', qty: 4, price: 20 },
        { id: 'v1', date: '2026-11-19', type: 'sell', qty: 6, price: 25, commission: 1 },
      ] } }),
      fx, { A: { price: 30 } }, {}, TODAY,
    )
    const b2 = list[0]!
    const b1 = list[1]!
    // La vendita chiude prima l'acquisto più recente (4 a 20), poi 2 del primo.
    expect(b2).toMatchObject({ openQty: 0, closedQty: 4, closedOn: '2026-11-19', valueEur: null })
    expect(b2.realizedEur).toBeCloseTo(4 * (149 / 6) - 80)
    expect(b1).toMatchObject({ openQty: 8, closedQty: 2 })
    expect(b1.openCostEur).toBeCloseTo(80)
    expect(b1.unrealizedEur).toBeCloseTo(160)
    expect(b1.realizedEur).toBeCloseTo(2 * (149 / 6) - 20)

    const tot = recentTotals(list)
    expect(tot).toMatchObject({ count: 2, costEur: 80, missingPrices: 0 })
    expect(tot.unrealizedEur).toBeCloseTo(160)
    expect(tot.unrealizedPct).toBeCloseTo(200)
  })

  it('short ricoperto e titoli senza prezzo', () => {
    const list = recentTrades(
      p({
        s: { ticker: 'S', transactions: [
          { date: '2026-11-20', type: 'short_sell', qty: 2, price: 50 },
          { date: '2026-11-23', type: 'buy_to_cover', qty: 2, price: 40 },
        ] },
        x: { ticker: 'X', transactions: [{ date: '2026-11-23', type: 'buy', qty: 1, price: 5 }] },
      }),
      fx, {}, {}, TODAY,
    )
    const s = list.find(t => t.symbol === 'S')!
    expect(s.realizedEur).toBeCloseTo(20)
    expect(recentTotals(list)).toMatchObject({ count: 2, missingPrices: 1, unrealizedPct: null })
    expect(inWindow(list, TODAY, 1).map(t => t.symbol)).toEqual(['X'])
  })
})
