import { describe, expect, it } from 'vitest'
import { parseYahooDividends } from './dividends.ts'

describe('parseYahooDividends', () => {
  it('ordina per data e scarta importi nulli', () => {
    const r = parseYahooDividends({
      chart: { result: [{ events: { dividends: { b: { date: 1_750_000_000, amount: 0.5 }, a: { date: 1_700_000_000, amount: 0.4 }, z: { date: 1_760_000_000, amount: 0 } } } }] },
    })
    expect(r.map(d => d.amount)).toEqual([0.4, 0.5])
    expect(r[0]!.exDate).toBe('2023-11-14')
  })
  it('senza dividendi torna vuoto', () => {
    expect(parseYahooDividends({})).toEqual([])
  })
})
