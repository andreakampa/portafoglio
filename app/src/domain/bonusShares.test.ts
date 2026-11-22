import { describe, expect, it } from 'vitest'
import { bonusKeyOf, buildBonusTx, dueGrants, grantId, unvestedTxs, vestingPrice, type BonusGrant } from './bonusShares.ts'
import { computeQuadroRM, holdingPieces, rmItemsFrom } from './engine/taxReturn.ts'

const g = (over: Partial<BonusGrant> = {}): BonusGrant => ({
  id: grantId('IBKR', '2026-05-01', 0), symbol: 'IBKR', isin: 'US45841N1072', currency: 'USD',
  qty: 0.4406, grantDate: '2026-05-01', vestDate: '2027-04-30', grantPrice: 79.5, ...over,
})

describe('azioni premio', () => {
  it('id adatto a Firebase', () => {
    expect(grantId('BRK.B', '2026-05-01', 2)).toBe('BRK_B_2026-05-01_2')
  })

  it('maturano dal giorno del vesting (registrate il giorno dopo, quando c’è la chiusura)', () => {
    expect(dueGrants([g()], [], '2027-04-30')).toHaveLength(0)
    expect(dueGrants([g()], [], '2027-05-01')).toHaveLength(1)
  })

  it('non si registrano due volte', () => {
    const tx = buildBonusTx(g(), { date: '2027-04-30', price: 100 }, () => 'x')
    expect(tx).toMatchObject({ type: 'buy', qty: 0.4406, price: 100, commission: 0, bonusKey: bonusKeyOf(g()), source: 'premio' })
    expect(dueGrants([g()], [tx], '2027-06-01')).toHaveLength(0)
  })

  it('prezzo al vesting: prima chiusura disponibile dal giorno di maturazione', () => {
    expect(vestingPrice({ '2027-05-03': 101 }, g({ vestDate: '2027-05-01' }), '2027-05-10')).toEqual({ date: '2027-05-03', price: 101 })
  })

  it('quadro RW: nel conto dall’assegnazione alla maturazione, poi c’è l’acquisto vero', () => {
    const real = buildBonusTx(g(), { date: '2027-04-30', price: 100 }, () => 'x')
    expect(holdingPieces(unvestedTxs([g()], []), 2026, { endClose: 90 })).toEqual([
      expect.objectContaining({ start: '2026-05-01', end: '2026-12-31', qty: 0.4406, startPrice: 79.5, endPrice: 90 }),
    ])
    expect(holdingPieces(unvestedTxs([g()], [real]), 2027, { startClose: 90 })).toEqual([
      expect.objectContaining({ start: '2027-01-01', end: '2027-04-29', endPrice: 100 }),
    ])
  })

  it('quadro RM: alla maturazione il valore è reddito (lettera G, Stato del broker)', () => {
    const tx = { ...buildBonusTx(g(), { date: '2027-04-30', price: 100 }, () => 'x'), exchangeRate: 1.25 }
    const rm = computeQuadroRM(rmItemsFrom({
      year: 2027, assets: { a: { ticker: 'IBKR', valuta: 'USD', transactions: [tx] } }, dividends: [], cashflows: [], etfGains: [],
      fx: () => undefined, brokerIso: 'IE',
    }))
    expect(rm.rows).toEqual([expect.objectContaining({ letter: 'G', iso: 'IE', country: { code: '040', name: 'Irlanda' } })])
    expect(rm.grossEur).toBeCloseTo((0.4406 * 100) / 1.25)
  })
})
