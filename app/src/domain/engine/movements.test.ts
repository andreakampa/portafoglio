import { describe, expect, it } from 'vitest'
import { buildMovements, marginInterest, periodRange } from './movements.ts'
import { computePortfolio, type RawPortfolio } from './portfolio.ts'

const p: RawPortfolio = {
  taxRegime: 'dichiarativo',
  assets: {
    a: {
      ticker: 'AAA',
      valuta: 'USD',
      transactions: [
        { id: 'b', date: '2026-01-10', type: 'buy', qty: 10, price: 100, exchangeRate: 1.25, marginAmount: 300 },
        { id: 's', date: '2026-03-10', type: 'sell', qty: 4, price: 110, exchangeRate: 1.1 },
        { id: 'x', date: '2026-04-10', type: 'short_sell', qty: 2, price: 120, exchangeRate: 1.1 },
        { id: 'c', date: '2026-05-10', type: 'buy_to_cover', qty: 2, price: 100, exchangeRate: 1.1 },
        { id: 't', date: '2026-06-10', type: 'transfer', qty: 1, price: 100, destPortfolioId: 'z' },
        { id: 'u', date: '2026-06-11', type: 'dividend', qty: 1, price: 1 },
      ],
    },
  },
}

describe('movimenti', () => {
  const list = buildMovements(p, computePortfolio(p, () => undefined))

  it('elenca tutti i tipi noti, dal più recente, ignorando quelli sconosciuti', () => {
    expect(list.map(m => m.kind)).toEqual(['transfer_out', 'buy_to_cover', 'short_sell', 'sell', 'buy'])
  })

  it('riporta prezzo di negoziazione, controvalore e margine', () => {
    const buy = list.find(m => m.kind === 'buy')!
    expect([buy.price, buy.gross, buy.currency, buy.marginAmount]).toEqual([100, 1000, 'USD', 300])
  })

  it('collega a vendite e chiusure short il loro risultato in EUR', () => {
    expect(list.find(m => m.kind === 'sell')!.gainEur).toBeCloseTo(440 / 1.1 - 320, 8)
    expect(list.find(m => m.kind === 'buy_to_cover')!.gainEur).toBeCloseTo(40 / 1.1, 8)
    expect(list.find(m => m.kind === 'buy')!.gainEur).toBeNull()
  })
})

describe('periodi', () => {
  it('calcola gli intervalli', () => {
    expect(periodRange('1m', '2026-03-31')).toEqual(['2026-03-03', '9999-12-31'])
    expect(periodRange('ytd', '2026-11-20')).toEqual(['2026-01-01', '9999-12-31'])
    expect(periodRange('2025', '2026-11-20')).toEqual(['2025-01-01', '2026-01-01'])
  })
})

describe('interessi di margine', () => {
  it('ordinati dal più recente, con importi numerici', () => {
    const rows = marginInterest({ marginInterest: [{ period: '2026-09', currency: 'usd', amount: '3.5' as unknown as number }, { period: '2026-10', currency: 'EUR', amount: 2 }] })
    expect(rows.map(r => [r.period, r.currency, r.amount])).toEqual([['2026-10', 'EUR', 2], ['2026-09', 'USD', 3.5]])
  })
})
