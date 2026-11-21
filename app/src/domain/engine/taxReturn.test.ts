import { describe, expect, it } from 'vitest'
import type { FiscalEventInput } from './fiscal.ts'
import {
  compareRates, computeQuadroRM, computeQuadroRT, computeQuadroRW, holdingPieces, rmItemsFrom, toEuro, valueHolding, withoutSavedRates,
} from './taxReturn.ts'

const ev = (date: string, proceeds: number, cost: number, extra: Partial<FiscalEventInput> = {}): FiscalEventInput => ({
  date, side: 'long', qty: 1, proceedsEur: proceeds, costEur: cost, gainEur: proceeds - cost, gainNative: proceeds - cost,
  assetId: 'a', assetName: 'AAA', assetType: 'stock', ...extra,
})

describe('quadro RT', () => {
  it('somma corrispettivi e costi dell’anno e calcola il 26% sulla plusvalenza netta', () => {
    const rt = computeQuadroRT([ev('2026-03-01', 1500, 1000), ev('2026-05-01', 800, 1000), ev('2025-02-01', 10, 5)], [], 2026)
    expect(rt.proceedsEur).toBe(2300)
    expect(rt.costEur).toBe(2000)
    expect(rt.netEur).toBe(300)
    expect(rt.taxableEur).toBe(300)
    expect(rt.taxEur).toBeCloseTo(78)
    expect(rt.newLossEur).toBe(0)
  })

  it('usa prima le minus più vecchie e riporta il resto (RT13 e RT102)', () => {
    const events = [ev('2022-01-10', 0, 100), ev('2025-01-10', 0, 500), ev('2026-06-01', 1300, 1000)]
    const rt = computeQuadroRT(events, [], 2026)
    expect(rt.usedLossesEur).toBe(300)
    expect(rt.taxableEur).toBe(0)
    expect(rt.priorLosses).toEqual([
      expect.objectContaining({ year: 2022, usedEur: 100, carriedEur: 0 }),
      expect.objectContaining({ year: 2025, usedEur: 200, carriedEur: 300 }),
    ])
  })

  it('le minus scadute non si usano e quelle che scadono quest’anno non si riportano', () => {
    const rt = computeQuadroRT([ev('2021-01-10', 0, 100), ev('2022-01-10', 0, 50), ev('2026-06-01', 10, 20)], [], 2026)
    expect(rt.priorLosses.map(p => p.year)).toEqual([2022])
    expect(rt.priorLosses[0]!.carriedEur).toBe(0)
    expect(rt.newLossEur).toBe(10)
  })

  it('minus inserite a mano entrano tra quelle disponibili', () => {
    const rt = computeQuadroRT([ev('2026-06-01', 200, 100)], [{ amount: 60, date: '2024-12-31', title: 'Redditi 2025' }], 2026)
    expect(rt.usedLossesEur).toBe(60)
    expect(rt.priorLosses[0]).toMatchObject({ year: 2024, manual: true })
  })

  it('titoli di Stato al 48,08%, plus di ETF al quadro RM, crypto a parte', () => {
    const rt = computeQuadroRT([
      ev('2026-02-01', 1000, 900, { assetType: 'bond' }),
      ev('2026-02-02', 500, 400, { assetType: 'etf' }),
      ev('2026-02-03', 300, 400, { assetType: 'etf' }),
      ev('2026-02-04', 50, 10, { assetType: 'crypto' }),
    ], [], 2026)
    expect(rt.proceedsEur).toBeCloseTo(1000 * 0.4808 + 300)
    expect(rt.netEur).toBeCloseTo(100 * 0.4808 - 100)
    expect(rt.etfGains).toHaveLength(1)
    expect(rt.crypto).toMatchObject({ netEur: 40, count: 1 })
  })
})

describe('quadro RM', () => {
  const assets = {
    a1: { ticker: 'MSFT', isin: 'US5949181045', tipoAsset: 'stock' },
    a2: { ticker: 'VWCE', isin: 'IE00BK5BQT80', tipoAsset: 'etf' },
  }
  it('un rigo per tipo e Stato, 26% sul lordo senza credito per la ritenuta', () => {
    const items = rmItemsFrom({
      year: 2026, assets,
      dividends: [
        { key: 'x', date: '2026-03-10', year: 2026, symbol: 'MSFT', currency: 'USD', grossEur: 100, withholdingEur: 15, taxEur: 26, netEur: 85, source: 'ibkr' },
        { key: 'y', date: '2026-06-10', year: 2026, symbol: 'msft', currency: 'USD', grossEur: 50, withholdingEur: 7.5, taxEur: 13, netEur: 42.5, source: 'ibkr' },
        { key: 'z', date: '2026-06-11', year: 2026, symbol: 'VWCE', currency: 'EUR', grossEur: 20, withholdingEur: 0, taxEur: 5.2, netEur: 20, source: 'ibkr' },
        { key: 'w', date: '2025-06-11', year: 2025, symbol: 'MSFT', currency: 'USD', grossEur: 999, withholdingEur: 0, taxEur: 0, netEur: 0, source: 'ibkr' },
      ],
      cashflows: [
        { date: '2026-04-03', kind: 'credit-interest', currency: 'USD', amount: 11, exchangeRate: 1.1 },
        { date: '2026-04-03', kind: 'lending', currency: 'EUR', amount: 2 },
        { date: '2026-04-03', kind: 'fee', currency: 'EUR', amount: -5 },
      ],
      etfGains: [ev('2026-07-01', 500, 400, { assetId: 'a2', assetName: 'VWCE', assetType: 'etf' })],
      fx: () => undefined,
      brokerIso: 'IE',
    })
    const rm = computeQuadroRM(items)
    const h = rm.rows.find(r => r.letter === 'H')!
    expect(h).toMatchObject({ iso: 'US', grossEur: 150, withholdingEur: 22.5, country: { code: '069' } })
    expect(h.taxEur).toBeCloseTo(39)
    const b = rm.rows.find(r => r.letter === 'B')!
    expect(b).toMatchObject({ iso: 'IE', grossEur: 120, country: { code: '040' } })
    expect(rm.rows.find(r => r.letter === 'G')!.grossEur).toBeCloseTo(10)
    expect(rm.rows.find(r => r.letter === 'C')!.grossEur).toBe(2)
    expect(rm.rows.map(r => r.letter)).toEqual(['B', 'C', 'G', 'H'])
  })

  it('riconosce il titolo dall’ISIN del movimento o dal ticker senza suffisso di borsa', () => {
    const base = { year: 2026, cashflows: [], etfGains: [], fx: () => undefined, brokerIso: 'IE' }
    const div = (symbol: string, isin?: string) => ({ key: symbol, date: '2026-05-01', year: 2026, symbol, ...(isin ? { isin } : {}), currency: 'USD', grossEur: 1, withholdingEur: 0, taxEur: 0, netEur: 1, source: 'ibkr' as const })
    const items = rmItemsFrom({ ...base, assets: { x: { ticker: 'AHLA.DE', valuta: 'EUR' } }, dividends: [div('AHLA'), div('IBKR', 'US45841N1072')] })
    expect(items.map(i => i.iso)).toEqual([null, 'US'])
    const items2 = rmItemsFrom({ ...base, assets: { x: { ticker: 'AHLA.DE', isin: 'US01609W1027' } }, dividends: [div('AHLA')] })
    expect(items2[0]!.iso).toBe('US')
  })
})

describe('quadro RW', () => {
  const txs = [
    { date: '2025-05-01', type: 'buy', qty: 10, price: 90 },
    { date: '2026-03-01', type: 'buy', qty: 5, price: 110 },
    { date: '2026-09-30', type: 'sell', qty: 8, price: 120 },
  ]
  it('periodi di possesso col LIFO: la vendita chiude prima l’acquisto più recente', () => {
    const p = holdingPieces(txs, 2026, { startClose: 100, endClose: 130 })
    expect(p).toEqual([
      expect.objectContaining({ qty: 5, start: '2026-03-01', end: '2026-09-30', startPrice: 110, endPrice: 120 }),
      expect.objectContaining({ qty: 3, start: '2026-01-01', end: '2026-09-30', startPrice: 100, endPrice: 120, days: 273 }),
      expect.objectContaining({ qty: 7, start: '2026-01-01', end: '2026-12-31', startPrice: 100, endPrice: 130, days: 365 }),
    ])
  })

  it('valori in euro al cambio medio mensile e IVAFE pro rata giorni', () => {
    const h = valueHolding('a', { ticker: 'X', valuta: 'USD', transactions: [{ date: '2025-01-02', type: 'buy', qty: 10, price: 50 }] }, 2026, { startClose: 100, endClose: 120 }, () => 1.2)!
    expect(h.startEur).toBeCloseTo(1000 / 1.2)
    expect(h.endEur).toBeCloseTo(1000)
    expect(h.days).toBe(365)
    expect(h.ivafeEur).toBeCloseTo(2)
    expect(h.missing).toEqual([])
  })

  it('segnala prezzi e cambi mancanti; titolo venduto prima dell’anno non compare', () => {
    const h = valueHolding('a', { valuta: 'USD', transactions: [{ date: '2025-01-02', type: 'buy', qty: 1, price: 5 }] }, 2026, {}, () => undefined)!
    expect(h.missing.length).toBeGreaterThan(0)
    expect(valueHolding('b', { transactions: [{ date: '2024-01-02', type: 'buy', qty: 1, price: 5 }, { date: '2024-06-02', type: 'sell', qty: 1, price: 6 }] }, 2026, {}, () => 1)).toBeNull()
  })

  it('rigo unico del deposito titoli e conto corrente sotto/sopra 5.000 €', () => {
    const h = valueHolding('a', { transactions: [{ date: '2025-01-02', type: 'buy', qty: 10, price: 50 }] }, 2026, { startClose: 100, endClose: 100 }, () => 1)!
    const rw = computeQuadroRW([h], 'IE', -2000)
    expect(rw.deposit).toMatchObject({ code: 20, country: { code: '040' }, startEur: 1000, endEur: 1000, days: 365 })
    expect(rw.cash.ivafeEur).toBe(0)
    expect(computeQuadroRW([h], 'IE', 8000).ivafeEur).toBeCloseTo(2 + 34.2)
  })
})

describe('cambi', () => {
  it('toglie i cambi salvati e confronta con la Banca d’Italia', () => {
    const assets = { a: { ticker: 'X', valuta: 'USD', transactions: [{ date: '2026-01-05', type: 'buy', qty: 10, price: 100, exchangeRate: 1.25 }] } }
    const stripped = withoutSavedRates({ p: { assets, cashflows: { c: { amount: 1, exchangeRate: 1.1 } } } as never })
    expect(stripped.p!.assets!.a!.transactions![0]).not.toHaveProperty('exchangeRate')
    expect((stripped.p as { cashflows: Record<string, object> }).cashflows.c).not.toHaveProperty('exchangeRate')
    const [row] = compareRates(assets, 2026, () => 1.2)
    expect(row!.diffEur).toBeCloseTo(1000 / 1.25 - 1000 / 1.2)
  })

  it('arrotonda all’euro', () => {
    expect(toEuro(10.5)).toBe(11)
    expect(toEuro(10.49)).toBe(10)
  })
})
