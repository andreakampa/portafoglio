import { describe, expect, it } from 'vitest'
import { computePortfolio } from './portfolio'
import type { RawTx } from './types'

// Opzioni: quantità = contratti × 100, prezzo = premio per azione. Tutto in EUR per leggere i numeri a occhio.
const fx = () => 1
const portfolio = (option: RawTx[], stock: RawTx[]) => ({
  taxRegime: 'dichiarativo',
  assets: {
    opt: { ticker: 'XYZ260619C00010000', valuta: 'EUR', tipoAsset: 'option', transactions: option },
    stk: { ticker: 'XYZ', valuta: 'EUR', tipoAsset: 'stock', transactions: stock },
  },
})

describe('opzioni esercitate o assegnate: il premio passa al sottostante', () => {
  it('call comprata ed esercitata: premio nel costo delle azioni, nessun risultato sull’opzione', () => {
    const r = computePortfolio(portfolio(
      [{ id: 'o1', date: '2026-01-10', type: 'buy', qty: 100, price: 2, commission: 1 }, { id: 'o2', date: '2026-06-19', type: 'exercise', qty: 100, price: 0, exerciseId: 'X1' }],
      [{ id: 's1', date: '2026-06-19', type: 'buy', qty: 100, price: 10, exerciseId: 'X1' }, { id: 's2', date: '2026-07-01', type: 'sell', qty: 100, price: 15 }],
    ), fx)
    expect(r.positions.opt!.qty).toBe(0)
    expect(r.positions.opt!.realized).toEqual([])
    // Costo azioni = 100 × 10 + premio 200 + commissione 1 = 1201; vendita a 1500 → plus 299.
    expect(r.positions.stk!.realized[0]!.costEur).toBeCloseTo(1201)
    expect(r.positions.stk!.realized[0]!.gainEur).toBeCloseTo(299)
    expect(r.issues).toEqual([])
  })

  it('put venduta e assegnata: il premio incassato abbassa il costo delle azioni comprate', () => {
    const r = computePortfolio(portfolio(
      [{ date: '2026-01-10', type: 'short_sell', qty: 100, price: 1.5 }, { date: '2026-03-20', type: 'exercise', qty: 100, price: 0, exerciseId: 'X2' }],
      [{ date: '2026-03-20', type: 'buy', qty: 100, price: 20, exerciseId: 'X2' }],
    ), fx)
    expect(r.positions.opt!.qty).toBe(0)
    expect(r.positions.stk!.costEur).toBeCloseTo(2000 - 150)
    expect(r.fiscal.lines).toEqual([])
  })

  it('call venduta e assegnata: il premio incassato alza il ricavo delle azioni vendute', () => {
    const r = computePortfolio(portfolio(
      [{ date: '2026-02-01', type: 'short_sell', qty: 100, price: 3 }, { date: '2026-04-17', type: 'exercise', qty: 100, price: 0, exerciseId: 'X3' }],
      [{ date: '2026-01-05', type: 'buy', qty: 100, price: 40 }, { date: '2026-04-17', type: 'sell', qty: 100, price: 45, exerciseId: 'X3' }],
    ), fx)
    expect(r.positions.stk!.realized[0]!.proceedsEur).toBeCloseTo(4500 + 300)
    expect(r.positions.stk!.realized[0]!.gainEur).toBeCloseTo(800)
  })

  it('put comprata ed esercitata: il premio pagato abbassa il ricavo della vendita', () => {
    const r = computePortfolio(portfolio(
      [{ date: '2026-02-01', type: 'buy', qty: 100, price: 4 }, { date: '2026-05-15', type: 'exercise', qty: 100, price: 0, exerciseId: 'X4' }],
      [{ date: '2026-01-05', type: 'buy', qty: 100, price: 50 }, { date: '2026-05-15', type: 'sell', qty: 100, price: 45, exerciseId: 'X4' }],
    ), fx)
    // Ricavo 4500 − premio 400 = 4100 contro costo 5000: minus 900 (perdita sul titolo + premio pagato).
    expect(r.positions.stk!.realized[0]!.gainEur).toBeCloseTo(-900)
  })

  it('esercizio parziale col LIFO e premio in euro al cambio dell’acquisto', () => {
    const r = computePortfolio({
      taxRegime: 'dichiarativo',
      assets: {
        opt: { valuta: 'USD', tipoAsset: 'option', transactions: [
          { date: '2026-01-10', type: 'buy', qty: 100, price: 1, exchangeRate: 1 },
          { date: '2026-02-10', type: 'buy', qty: 100, price: 3, exchangeRate: 1.25 },
          { date: '2026-06-19', type: 'exercise', qty: 100, price: 0, exerciseId: 'X5', exchangeRate: 1.1 },
        ] },
        stk: { valuta: 'USD', transactions: [{ date: '2026-06-19', type: 'buy', qty: 100, price: 10, exerciseId: 'X5', exchangeRate: 1.1 }] },
      },
    }, () => undefined)
    // LIFO: si esercita il lotto del 10/2 (premio 300 USD = 240 € al cambio di allora).
    expect(r.positions.opt!.qty).toBe(100)
    expect(r.positions.stk!.costNative).toBeCloseTo(1000 + 300)
    expect(r.positions.stk!.costEur).toBeCloseTo(1000 / 1.1 + 240)
  })
})
