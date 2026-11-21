import { describe, expect, it } from 'vitest'
import { parseCloses } from './priceHistory.ts'

describe('parseCloses', () => {
  it('associa ogni data alla sua chiusura e salta i buchi', () => {
    const r = parseCloses({ chart: { result: [{ timestamp: [1_700_000_000, 1_700_086_400, 1_700_172_800], indicators: { quote: [{ close: [10.5, null, 11] }] } }] } })
    expect(r).toEqual({ '2023-11-14': 10.5, '2023-11-16': 11 })
  })
  it('risposta vuota', () => {
    expect(parseCloses({})).toEqual({})
  })
})
