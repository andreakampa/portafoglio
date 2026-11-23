import { describe, expect, it } from 'vitest'
import { downsample, parseYahoo } from './prices.ts'

describe('parseYahoo', () => {
  it('prezzo, chiusura di ieri, 52 settimane e prezzi del giorno (senza buchi)', () => {
    const q = parseYahoo({
      chart: {
        result: [{
          meta: { symbol: 'GOOGL', regularMarketPrice: 282.1, chartPreviousClose: 265.29, currency: 'USD', regularMarketTime: 10, fiftyTwoWeekLow: 264.22, fiftyTwoWeekHigh: 408.61 },
          indicators: { quote: [{ close: [280.3349914550781, null, 277.5] }] },
        }],
      },
    })
    expect(q).toMatchObject({ symbol: 'GOOGL', price: 282.1, previousClose: 265.29, low52: 264.22, high52: 408.61, time: 10000 })
    expect(q?.spark).toEqual([280.335, 277.5])
  })
  it('riduce le serie lunghe tenendo primo e ultimo punto', () => {
    const xs = Array.from({ length: 79 }, (_, i) => i)
    const d = downsample(xs, 40)
    expect(d).toHaveLength(40)
    expect(d[0]).toBe(0)
    expect(d[39]).toBe(78)
  })
})
