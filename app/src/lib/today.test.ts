import { describe, expect, it } from 'vitest'
import { localToday } from './today'

describe('data di oggi', () => {
  it('usa il giorno locale, non quello UTC', () => {
    expect(localToday(new Date(2026, 10, 24, 0, 15))).toBe('2026-11-24')
    expect(localToday(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
  })
})
