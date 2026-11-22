import { describe, expect, it } from 'vitest'
import { vixStatus } from './market.ts'

describe('VIX', () => {
  it('calmo sotto 20, nervoso fino a 25, paura da 25', () => {
    expect(vixStatus(15).key).toBe('good')
    expect(vixStatus(22).key).toBe('warning')
    expect(vixStatus(25).key).toBe('critical')
  })
})
