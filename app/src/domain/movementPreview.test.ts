import { describe, expect, it } from 'vitest'
import type { RawPortfolio } from './engine/portfolio'
import type { RawTx } from './engine/types'
import { previewMovement } from './movementPreview'

const noFx = () => undefined
const pf = (regime: string, txs: RawTx[]): RawPortfolio => ({
  taxRegime: regime,
  assets: { x: { ticker: 'XXX', valuta: 'EUR', tipoAsset: 'stock', transactions: [{ id: 'b1', date: '2026-01-10', type: 'buy', qty: 10, price: 100 }, ...txs] } },
})
const run = (p: RawPortfolio, tx: RawTx, extra: Partial<Parameters<typeof previewMovement>[0]> = {}) =>
  previewMovement({ portfolio: p, fx: noFx, latestFx: {}, assetId: 'x', tx, ...extra })

describe('anteprima del movimento', () => {
  it('acquisto: nuova quantità e PMC con commissioni, spesa', () => {
    const r = run(pf('amministrato', []), { id: 'n', date: '2026-03-01', type: 'buy', qty: 10, price: 120, commission: 10 })
    expect(r.before).toMatchObject({ qty: 10, pmcEur: 100 })
    expect(r.after.qty).toBe(20)
    expect(r.after.pmcEur).toBeCloseTo(2210 / 20, 8)
    expect(r.cashEur).toBeCloseTo(-1210, 8)
    expect(r.overLimit).toBeNull()
  })

  it('vendita: plus, imposta con minus compensate, incasso netto', () => {
    const p = pf('amministrato', [{ id: 'l', date: '2026-02-01', type: 'sell', qty: 2, price: 75 }]) // minus 50 €
    const r = run(p, { id: 'n', date: '2026-03-01', type: 'sell', qty: 4, price: 150, commission: 5 })
    expect(r.gainEur).toBeCloseTo(195, 8)
    expect(r.lossesUsedEur).toBeCloseTo(50, 8)
    expect(r.taxEur).toBeCloseTo(145 * 0.26, 8)
    expect(r.cashEur).toBeCloseTo(600 - 5 - r.taxEur, 8)
  })

  it('vendita oltre la quantità: blocco con il disponibile', () => {
    const r = run(pf('amministrato', []), { id: 'n', date: '2026-03-01', type: 'sell', qty: 12, price: 100 })
    expect(r.overLimit).toMatchObject({ own: true, available: 10 })
  })

  it('vendita retrodatata che fa sforare una vendita successiva', () => {
    const p = pf('amministrato', [{ id: 's', date: '2026-05-01', type: 'sell', qty: 8, price: 100 }])
    const r = run(p, { id: 'n', date: '2026-03-01', type: 'sell', qty: 5, price: 100 })
    expect(r.overLimit).toMatchObject({ own: false, date: '2026-05-01', available: 5 })
  })

  it('modifica: sostituisce il movimento invece di aggiungerlo', () => {
    const p = pf('amministrato', [{ id: 's', date: '2026-05-01', type: 'sell', qty: 8, price: 100 }])
    const r = run(p, { id: 's', date: '2026-05-01', type: 'sell', qty: 10, price: 100 }, { replaceIndex: 1 })
    expect(r.overLimit).toBeNull()
    expect(r.after.qty).toBe(0)
  })

  it('titolo nuovo e cambio mancante: usa l’ultimo cambio e lo dice', () => {
    const r = run({ taxRegime: 'amministrato', assets: {} }, { id: 'n', date: '2026-03-01', type: 'buy', qty: 2, price: 110 }, {
      assetId: 'x', newAsset: { ticker: 'NEW', valuta: 'USD' }, latestFx: { USD: 1.1 },
    })
    expect(r.grossEur).toBeCloseTo(200, 8)
    expect(r.fxEstimated).toBe(true)
    expect(r.after.qty).toBe(2)
  })
})
