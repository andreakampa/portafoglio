import { describe, expect, it } from 'vitest'
import { computeFiscal } from './engine/fiscal'
import { buildManualLoss, daysToExpiry, formOf, removeManualLoss, replaceManualLoss, validateManualLoss, type ManualLossForm } from './manualLosses'

const form = (o: Partial<ManualLossForm> = {}): ManualLossForm => ({ date: '2026-04-15', amount: '204,81', title: 'Fondo MBB', categoria: 'strumenti', ...o })

describe('minus inserite a mano', () => {
  it('controlli: data, importo, descrizione', () => {
    expect(validateManualLoss(form(), '2026-11-24')).toBeNull()
    expect(validateManualLoss(form({ date: '2026-12-01' }), '2026-11-24')).toMatch(/futuro/)
    expect(validateManualLoss(form({ amount: '0' }), '2026-11-24')).toMatch(/importo/)
    expect(validateManualLoss(form({ title: ' ' }), '2026-11-24')).toMatch(/da dove/)
  })

  it('importo con virgola o punti delle migliaia; stessi campi del sito vecchio', () => {
    expect(buildManualLoss(form())).toEqual({ amount: 204.81, date: '2026-04-15', year: 2026, title: 'Fondo MBB', categoria: 'strumenti' })
    expect(buildManualLoss(form({ amount: '1.234,5' })).amount).toBe(1234.5)
    expect(buildManualLoss(form({ amount: '204.81' })).amount).toBe(204.81)
    expect(buildManualLoss(form({ amount: '5.000' })).amount).toBe(5000)
  })

  it('il motore la mette nel cassetto e compensa le plus successive', () => {
    const f = computeFiscal([{ assetId: 'x', assetName: 'X', assetType: 'stock', date: '2026-06-01', side: 'long', gainEur: 300, qty: 1, proceedsEur: 0, costEur: 0, gainNative: 300 }], [buildManualLoss(form())])
    expect(f.lines.find(l => l.side === 'manuale')!.gainEur).toBeCloseTo(-204.81)
    expect(f.lines.find(l => l.side === 'long')!.compensatedEur).toBeCloseTo(204.81)
  })

  it('elimina solo se la voce è ancora quella vista', () => {
    const a = buildManualLoss(form())
    const b = buildManualLoss(form({ date: '2025-02-01', amount: '50' }))
    expect(removeManualLoss([a, b], 1, b)).toEqual([a])
    expect(removeManualLoss([a, b], 1, a)).toBeUndefined()
    expect(removeManualLoss([a], 3, a)).toBeUndefined()
  })

  it('modifica: il modulo si riempie dalla voce salvata e la sostituisce solo se è ancora quella vista', () => {
    const a = buildManualLoss(form())
    const b = buildManualLoss(form({ date: '2025-02-01', amount: '50' }))
    const f = formOf(a)
    expect(buildManualLoss(f)).toEqual(a)
    const changed = buildManualLoss({ ...f, amount: '199,9', date: '2025-12-30' })
    expect(replaceManualLoss([a, b], 0, a, changed)).toEqual([changed, b])
    expect(replaceManualLoss([a, b], 0, b, changed)).toBeUndefined()
  })

  it('giorni alla scadenza del 31/12', () => {
    expect(daysToExpiry(2026, '2026-11-24')).toBe(37)
    expect(daysToExpiry(2026, '2026-12-31')).toBe(0)
  })
})
