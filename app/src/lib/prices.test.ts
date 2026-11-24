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

describe('pre-market e after-market', () => {
  const period = { pre: { start: 100, end: 200 }, regular: { start: 200, end: 300 }, post: { start: 300, end: 400 } }
  const chart = (timestamp: number[], close: (number | null)[]) => ({
    chart: { result: [{
      meta: { symbol: 'AMZN', regularMarketPrice: 200, chartPreviousClose: 190, currency: 'USD', currentTradingPeriod: period },
      timestamp, indicators: { quote: [{ close }] },
    }] },
  })
  it('after-market: ultimo prezzo dopo la chiusura, variazione sul prezzo della seduta', () => {
    const q = parseYahoo(chart([210, 250, 290, 310, 350], [198, 199, 200, 202, 204]))
    expect(q?.ext).toEqual({ kind: 'post', price: 204, pct: 2 })
    expect(q?.spark).toEqual([198, 199, 200]) // il grafichino resta sulla seduta normale
  })
  it('pre-market: ultimo prezzo prima dell\'apertura', () => {
    const q = parseYahoo(chart([110, 150], [195, 190]))
    expect(q?.ext).toEqual({ kind: 'pre', price: 190, pct: -5 })
  })
  it("asta di chiusura (borse europee, esattamente all'orario di chiusura): seduta normale", () => {
    const q = parseYahoo(chart([210, 300], [198, 201]))
    expect(q?.ext).toBeNull()
    expect(q?.spark).toEqual([198, 201])
  })
  it('durante la seduta, o senza orari: niente fuori orario', () => {
    expect(parseYahoo(chart([150, 250], [195, 201]))?.ext).toBeNull()
    expect(parseYahoo({ chart: { result: [{ meta: { symbol: 'ENI.MI', regularMarketPrice: 14 }, indicators: { quote: [{ close: [14] }] } }] } })?.ext).toBeNull()
  })
})
