import { describe, expect, it } from 'vitest'
import { syncHeadline, syncStatusFromDb } from './ibkrSync'

describe('stato sincronizzazione IBKR', () => {
  it('senza dati non c’è stato', () => {
    expect(syncStatusFromDb(null)).toBeNull()
    expect(syncStatusFromDb('boh')).toBeNull()
  })

  it('campi mancanti (Firebase toglie gli array vuoti) diventano elenchi vuoti', () => {
    const s = syncStatusFromDb({ lastRun: '2026-11-21T06:00:00Z', ok: true, added: ['AMZN buy'] })!
    expect(s.added).toEqual(['AMZN buy'])
    expect(s.review).toEqual([])
    expect(s.skipped).toEqual([])
    expect(s.lastError).toBeUndefined()
  })

  it('legge l’errore e scarta valori di tipo sbagliato', () => {
    const s = syncStatusFromDb({ review: ['a', 3, 'b'], lastError: { at: 'x', message: 'IBKR giù' } })!
    expect(s.review).toEqual(['a', 'b'])
    expect(s.lastError).toEqual({ at: 'x', message: 'IBKR giù' })
    expect(syncStatusFromDb({ lastError: { at: 'x' } })!.lastError).toBeUndefined()
  })

  it('riga di riepilogo', () => {
    expect(syncHeadline(syncStatusFromDb({ added: ['a', 'b', 'c'], review: ['x'] })!)).toBe('3 operazioni importate, 1 da controllare')
    expect(syncHeadline(syncStatusFromDb({ added: ['a'] })!)).toBe('1 operazione importata, 0 da controllare')
  })
})
