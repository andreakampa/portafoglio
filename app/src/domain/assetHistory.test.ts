import { describe, expect, it } from 'vitest'
import { assetHistory } from './assetHistory.ts'
import { computePortfolio, type RawPortfolio } from './engine/portfolio.ts'
import type { FxLookup } from './engine/types.ts'

const fx: FxLookup = (cur, date) => (cur === 'USD' ? ({ '2026-01-10': 1.25, '2026-02-10': 1, '2026-03-10': 1.1 } as Record<string, number>)[date] : undefined)

describe('storico del titolo', () => {
  const p = {
    taxRegime: 'amministrato',
    assets: {
      x: {
        ticker: 'XYZ', valuta: 'USD',
        transactions: [
          { id: 'b1', date: '2026-01-10', type: 'buy', qty: 10, price: 10, commission: 1, commissionCurrency: 'EUR', source: 'pac' },
          { id: 'b2', date: '2026-02-10', type: 'buy', qty: 10, price: 20, commission: 0 },
          { id: 's1', date: '2026-03-10', type: 'sell', qty: 5, price: 33, commission: 0 },
          { id: 'bad', date: '2026-03-11', type: 'sell', qty: 0, price: 1 },
        ],
      },
      y: { ticker: 'ALTRO', valuta: 'EUR', transactions: [{ id: 'z', date: '2026-01-01', type: 'buy', qty: 1, price: 1 }] },
    },
  } as unknown as RawPortfolio
  const r = computePortfolio(p, fx)
  const h = assetHistory(p, r, 'x')

  it('solo i movimenti del titolo, dal più recente', () => {
    expect(h.rows.map(x => x.m.txId)).toEqual(['bad', 's1', 'b2', 'b1'])
  })
  it('prezzo in euro e cambio del giorno, totale con le commissioni in valuta del titolo', () => {
    const b1 = h.rows.find(x => x.m.txId === 'b1')!
    expect(b1.rate).toBe(1.25)
    expect(b1.priceEur).toBeCloseTo(8)
    // 100 $ + 1 € di commissioni (= 1,25 $)
    expect(b1.totalNative).toBeCloseTo(101.25)
    expect(b1.qtyAfter).toBe(10)
  })
  it('PMC dopo ogni movimento, plus della vendita con imposta e netto', () => {
    const s1 = h.rows.find(x => x.m.txId === 's1')!
    expect(s1.qtyAfter).toBe(15)
    expect(s1.pmcNativeAfter).toBeCloseTo((101.25 + 200) / 20)
    expect(s1.gainEur).not.toBeNull()
    expect(s1.taxEur).toBeCloseTo(s1.gainEur! * 0.26)
    expect(s1.netEur).toBeCloseTo(s1.gainEur! - s1.taxEur!)
  })
  it('avvisi del motore sulla riga e riepilogo', () => {
    expect(h.rows.find(x => x.m.txId === 'bad')!.issues.join(' ')).toMatch(/Quantità non valida/)
    expect(h.summary.qty).toBe(15)
    expect(h.summary.pac).toBe(true)
    expect(h.summary.realizedNetEur).toBeCloseTo(h.summary.realizedEur * 0.74)
    expect(h.summary.commissionsEur).toBeCloseTo(1)
  })
})
