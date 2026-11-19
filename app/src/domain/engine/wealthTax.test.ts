import { describe, expect, it } from 'vitest'
import { daysInYear, wealthTax, wealthTaxKindFor } from './wealthTax.ts'

describe('bollo e IVAFE', () => {
  it('2 per mille sul valore, anno intero', () => {
    expect(wealthTax({ kind: 'bollo', valueEur: 50_000 })).toBeCloseTo(100, 8)
    expect(wealthTax({ kind: 'ivafe', valueEur: 50_000 })).toBeCloseTo(100, 8)
  })

  it('proporzionato ai giorni di possesso', () => {
    expect(wealthTax({ kind: 'ivafe', valueEur: 36_500, daysHeld: 73 })).toBeCloseTo(14.6, 8)
  })

  it('IVAFE al 4 per mille nei paradisi fiscali (non vale per il bollo)', () => {
    expect(wealthTax({ kind: 'ivafe', valueEur: 10_000, taxHaven: true })).toBeCloseTo(40, 8)
    expect(wealthTax({ kind: 'bollo', valueEur: 10_000, taxHaven: true })).toBeCloseTo(20, 8)
  })

  it('niente valore, niente imposta', () => {
    expect(wealthTax({ kind: 'bollo', valueEur: 0 })).toBe(0)
    expect(wealthTax({ kind: 'bollo', valueEur: -5 })).toBe(0)
  })

  it('tipo di imposta in base al regime e anni bisestili', () => {
    expect(wealthTaxKindFor('dichiarativo')).toBe('ivafe')
    expect(wealthTaxKindFor('amministrato')).toBe('bollo')
    expect(daysInYear(2028)).toBe(366)
    expect(daysInYear(2026)).toBe(365)
  })
})
