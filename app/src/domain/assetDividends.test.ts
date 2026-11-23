import { describe, expect, it } from 'vitest'
import { assetDividends } from './assetDividends.ts'
import type { DividendRow } from './engine/dividends.ts'
import type { RawAsset } from './engine/types.ts'

const asset = {
  ticker: 'MSFT', valuta: 'USD',
  transactions: [{ date: '2026-01-05', type: 'buy', qty: 10, price: 400 }, { date: '2026-06-01', type: 'buy', qty: 10, price: 400 }],
} as RawAsset
const yahoo = [{ exDate: '2026-02-18', amount: 0.83 }, { exDate: '2026-11-10', amount: 0.91 }, { exDate: '2025-11-10', amount: 0.83 }, { exDate: '2026-12-10', amount: 0.91 }]
const fx = (_c: string, d: string) => (d === '2026-02-18' ? 1.04 : d === '2026-11-10' ? 1.1 : undefined)
const base = { asset, assetId: 'm', yahoo, fx, today: '2026-11-20', broker: [] as DividendRow[], manual: {} }

describe('dividendi del titolo', () => {
  it('solo stacchi passati con azioni possedute e cambio; quantità allo stacco; stato pagato/maturato', () => {
    const { rows } = assetDividends({ ...base, regime: 'amministrato' })
    expect(rows.map(r => r.exDate)).toEqual(['2026-11-10', '2026-02-18'])
    expect(rows[0]).toMatchObject({ qty: 20, status: 'maturato', payDate: '2026-12-01', payDateEstimated: true })
    expect(rows[1]).toMatchObject({ qty: 10, status: 'pagato' })
    expect(rows[1]!.totalNative).toBeCloseTo(8.3)
    expect(rows[1]!.totalEur).toBeCloseTo(8.3 / 1.04)
  })
  it('netto atteso: amministrato toglie ritenuta USA e 26%, dichiarativo solo la ritenuta', () => {
    const lordo = 8.3 / 1.04
    expect(assetDividends({ ...base, regime: 'amministrato' }).rows[1]!.expectedNetEur).toBeCloseTo(lordo * 0.85 * 0.74)
    expect(assetDividends({ ...base, regime: 'dichiarativo' }).rows[1]!.expectedNetEur).toBeCloseTo(lordo * 0.85)
  })
  it('netto reale a mano con avviso oltre il 3%', () => {
    const lordo = 8.3 / 1.04
    const atteso = lordo * 0.85 * 0.74
    const ok = assetDividends({ ...base, regime: 'amministrato', manual: { '2026-02-18': atteso * 1.02 } })
    expect(ok.rows[1]).toMatchObject({ realSource: 'manuale', anomaly: false })
    const ko = assetDividends({ ...base, regime: 'amministrato', manual: { '2026-02-18': lordo * 0.74 } })
    expect(ko.rows[1]!.anomaly).toBe(true)
    expect(ko.summary.anomalies).toBe(1)
  })
  it('accredito IBKR dello stesso titolo dopo lo stacco: netto reale vero e data vera', () => {
    const credit = { key: 'k', date: '2026-03-12', year: 2026, symbol: 'MSFT', currency: 'USD', grossEur: 7.98, withholdingEur: 1.2, taxEur: 0, netEur: 0, source: 'ibkr' } as DividendRow
    const { rows } = assetDividends({ ...base, regime: 'dichiarativo', broker: [credit] })
    expect(rows[1]).toMatchObject({ realSource: 'ibkr', payDate: '2026-03-12', payDateEstimated: false, status: 'pagato' })
    expect(rows[1]!.realNetEur).toBeCloseTo(6.78)
  })
  it('riepilogo: maturati, totale pagato in € e $, ultimo pagamento', () => {
    const { summary } = assetDividends({ ...base, regime: 'amministrato' })
    expect(summary.maturedCount).toBe(1)
    expect(summary.lastExDate).toBe('2026-11-10')
    expect(summary.paidNative).toBeCloseTo(8.3)
    expect(summary.lastPayment!.date).toBe('2026-03-11')
  })
})
