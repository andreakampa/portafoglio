import { describe, expect, it } from 'vitest'
import { notesFromDb, parseTickers, sortNotes, upcoming, type Note } from './notes'

const n = (id: string, extra: Partial<Note> = {}): Note => ({ id, kind: 'idea', title: id, createdAt: 1, updatedAt: 1, ...extra })

describe('note', () => {
  it('ticker: maiuscoli, senza doppioni né spazzatura', () => {
    expect(parseTickers(' aapl, msft  nvda;aapl  RACE.MI ^vix ')).toEqual(['AAPL', 'MSFT', 'NVDA', 'RACE.MI', '^VIX'])
    expect(parseTickers('ciao mondo!!')).toEqual(['CIAO'])
  })

  it('legge da Firebase scartando le note senza titolo e correggendo i tipi sconosciuti', () => {
    const list = notesFromDb({ a: { title: 'x', kind: 'boh', createdAt: 5 }, b: { body: 'senza titolo' }, c: null })
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ id: 'a', kind: 'idea', updatedAt: 5, tickers: [] })
    expect(notesFromDb(null)).toEqual([])
  })

  it('ordina: fissate, poi recenti, completate in fondo', () => {
    const sorted = sortNotes([n('vecchia', { updatedAt: 1 }), n('fatta', { done: true, pinned: true, updatedAt: 9 }), n('nuova', { updatedAt: 5 }), n('fissata', { pinned: true })])
    expect(sorted.map(x => x.id)).toEqual(['fissata', 'nuova', 'vecchia', 'fatta'])
  })

  it('prossimi eventi entro 30 giorni, esclusi passati e completati', () => {
    const list = [n('oggi', { date: '2026-11-20' }), n('ieri', { date: '2026-11-19' }), n('tra40', { date: '2026-12-30' }), n('tra10', { date: '2026-11-30' }), n('fatto', { date: '2026-11-25', done: true })]
    expect(upcoming(list, '2026-11-20').map(x => x.id)).toEqual(['oggi', 'tra10'])
  })
})
