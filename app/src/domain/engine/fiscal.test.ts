import { describe, expect, it } from 'vitest'
import { availableLosses, computeFiscal, type FiscalEventInput } from './fiscal.ts'

const ev = (date: string, gainEur: number, assetType = 'stock', assetId = 'a'): FiscalEventInput => ({
  assetId, assetName: assetId, assetType, date, side: 'long', qty: 1, proceedsEur: 0, costEur: 0, gainEur, gainNative: gainEur,
})

describe('cassetto fiscale', () => {
  it('una plus usa le minus precedenti e paga il 26% solo sul resto', () => {
    const r = computeFiscal([ev('2026-01-10', -100), ev('2026-03-10', 150)])
    const plus = r.lines.find(l => l.gainEur > 0)!
    expect(plus.compensatedEur).toBeCloseTo(100, 8)
    expect(plus.taxableEur).toBeCloseTo(50, 8)
    expect(plus.taxEur).toBeCloseTo(13, 8)
    expect(availableLosses(r, 2026)).toBeCloseTo(0, 8)
  })

  it('le minus valgono fino al quarto anno successivo, poi scadono', () => {
    const r = computeFiscal([ev('2022-05-01', -100), ev('2026-12-31', 40), ev('2027-01-02', 100)])
    const [, p2026, p2027] = r.lines
    expect(p2026!.compensatedEur).toBeCloseTo(40, 8) // 2022 + 4 = 2026: ancora valida
    expect(p2027!.compensatedEur).toBe(0) // nel 2027 è scaduta
    expect(availableLosses(r, 2026)).toBeCloseTo(60, 8)
    expect(availableLosses(r, 2027)).toBe(0)
  })

  it('si usano prima le minus più vecchie', () => {
    const r = computeFiscal([ev('2024-01-01', -50), ev('2025-01-01', -50), ev('2026-01-01', 60)])
    expect(r.buckets.map(b => [b.year, b.remainingEur])).toEqual([
      [2024, 0],
      [2025, 40],
    ])
  })

  it('una minus successiva non compensa una plus già realizzata', () => {
    const r = computeFiscal([ev('2026-01-10', 100), ev('2026-03-10', -100)])
    expect(r.lines[0]!.taxableEur).toBeCloseTo(100, 8)
    expect(availableLosses(r, 2026)).toBeCloseTo(100, 8)
  })

  it('dichiarativo: le minus dell’anno compensano anche le plus realizzate prima', () => {
    const events = [ev('2026-01-10', 100), ev('2026-03-10', -60)]
    const amm = computeFiscal(events, [], 'amministrato')
    const dich = computeFiscal(events, [{ amount: 30, date: '2026-12-31' }], 'dichiarativo')
    expect(amm.lines.find(l => l.gainEur > 0)!.taxableEur).toBeCloseTo(100, 8)
    expect(dich.lines.find(l => l.gainEur > 0)!.compensatedEur).toBeCloseTo(90, 8)
    expect(dich.lines.find(l => l.gainEur > 0)!.taxEur).toBeCloseTo(2.6, 8)
  })

  it('dichiarativo: le minus di un anno non tornano indietro sugli anni prima', () => {
    const r = computeFiscal([ev('2025-06-01', 100), ev('2026-01-10', -100)], [], 'dichiarativo')
    expect(r.lines[0]!.taxableEur).toBeCloseTo(100, 8)
    expect(availableLosses(r, 2026)).toBeCloseTo(100, 8)
  })

  it('crypto e altri strumenti hanno cassetti separati', () => {
    const r = computeFiscal([ev('2026-01-10', -100, 'crypto'), ev('2026-03-10', 100, 'stock')])
    expect(r.lines[1]!.compensatedEur).toBe(0)
    expect(r.lines[1]!.taxEur).toBeCloseTo(26, 8)
    expect(availableLosses(r, 2026, 'crypto')).toBeCloseTo(100, 8)
  })

  it('le plus di fondi ed ETF non si compensano, le loro minus sì', () => {
    const r = computeFiscal([ev('2026-01-10', -100, 'etf'), ev('2026-02-10', 100, 'etf'), ev('2026-03-10', 100, 'stock')])
    expect(r.lines[1]!.excluded).toBe('fondo-etf')
    expect(r.lines[1]!.taxableEur).toBeCloseTo(100, 8)
    expect(r.lines[2]!.compensatedEur).toBeCloseTo(100, 8)
  })

  it('aliquote: titoli di Stato 12,5% effettivo (48,08% × 26%), crypto 33%', () => {
    const r = computeFiscal([ev('2026-01-10', 100, 'bond'), ev('2026-01-11', 100, 'crypto')])
    expect(r.lines[0]!.taxEur).toBeCloseTo(12.5, 2)
    expect(r.lines[1]!.taxEur).toBeCloseTo(33, 8)
  })

  it('titoli di Stato: la minus compensa solo per il 48,08%', () => {
    const r = computeFiscal([ev('2026-01-10', -100, 'bond'), ev('2026-03-10', 100, 'stock')])
    const plus = r.lines[1]!
    expect(plus.compensatedEur).toBeCloseTo(48.08, 8)
    expect(plus.taxEur).toBeCloseTo((100 - 48.08) * 0.26, 8)
  })

  it('titoli di Stato: una minus su azioni compensa la plus su BTP sulla base ridotta', () => {
    const r = computeFiscal([ev('2026-01-10', -100, 'stock'), ev('2026-03-10', 100, 'bond')])
    expect(r.lines[1]!.compensatedEur).toBeCloseTo(48.08, 8)
    expect(r.lines[1]!.taxEur).toBe(0)
    expect(availableLosses(r, 2026)).toBeCloseTo(51.92, 8)
  })

  it('le minus inserite a mano entrano nel cassetto', () => {
    const r = computeFiscal([ev('2026-05-10', 300)], [{ amount: 204.81, date: '2026-04-15', title: 'Fondo' }])
    const plus = r.lines.find(l => l.gainEur > 0)!
    expect(plus.compensatedEur).toBeCloseTo(204.81, 8)
    expect(r.lines.find(l => l.side === 'manuale')!.gainEur).toBeCloseTo(-204.81, 8)
  })

  it('a parità di data la minus manuale viene prima', () => {
    const r = computeFiscal([ev('2026-05-10', 100)], [{ amount: 50, date: '2026-05-10' }])
    expect(r.lines.find(l => l.gainEur > 0)!.compensatedEur).toBeCloseTo(50, 8)
  })

  it('dice quale minus è stata usata su quale plus, prima le più vecchie', () => {
    // Come Mediolanum 2026: Porsche in perdita, minus a mano del fondo, poi due plus.
    const r = computeFiscal(
      [ev('2026-03-04', -207.12, 'stock', 'P911'), ev('2026-04-17', 399.73, 'stock', 'INFQ'), ev('2026-06-26', 642.27, 'stock', 'META')],
      [{ amount: 204.81, date: '2026-04-15', title: 'Fondo MBB' }],
    )
    const by = (id: string) => r.lines.find(l => l.assetId === id)!
    const manual = r.lines.find(l => l.side === 'manuale')!
    expect(manual.manualIndex).toBe(0)
    expect(by('INFQ').usedFrom!.map(u => [u.key, Math.round(u.eur * 100) / 100])).toEqual([
      [by('P911').key, 207.12],
      [manual.key, 192.61],
    ])
    expect(by('META').usedFrom!.map(u => [u.key, Math.round(u.eur * 100) / 100])).toEqual([[manual.key, 12.2]])
    expect(manual.usedBy!.map(u => [u.key, Math.round(u.eur * 100) / 100])).toEqual([
      [by('INFQ').key, 192.61],
      [by('META').key, 12.2],
    ])
    expect(by('P911').usedBy!.map(u => u.key)).toEqual([by('INFQ').key])
    expect(by('META').taxEur).toBeCloseTo((642.27 - 12.2) * 0.26, 6)
  })

  it('una minus non usata non ha usedBy, una plus non compensata non ha usedFrom', () => {
    const r = computeFiscal([ev('2026-01-10', 100, 'stock', 'a'), ev('2026-03-10', -50, 'stock', 'b')])
    expect(r.lines[0]!.usedFrom).toBeUndefined()
    expect(r.lines[1]!.usedBy).toBeUndefined()
  })
})
