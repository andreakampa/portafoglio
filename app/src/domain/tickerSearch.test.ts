import { describe, expect, it } from 'vitest'
import { parseSearch, resolveCurrency, searchUrl } from './tickerSearch'

describe('ricerca del titolo', () => {
  it('valuta dalla borsa del ticker, poi da Yahoo', () => {
    expect(resolveCurrency('RACE.MI', 'EUR')).toBe('EUR')
    expect(resolveCurrency('SAP.DE')).toBe('EUR')
    expect(resolveCurrency('SHOP.TO', 'USD')).toBe('CAD')
    expect(resolveCurrency('VOD.L', 'GBp')).toBe('GBP')
    expect(resolveCurrency('NVDA', 'USD')).toBe('USD')
    expect(resolveCurrency('BTC-EUR', 'EUR')).toBe('EUR')
    expect(resolveCurrency('RACEN.MX')).toBe('MXN')
    expect(resolveCurrency('NOVO-B.CO')).toBe('DKK')
    expect(resolveCurrency('XYZ')).toBe('USD')
  })

  it('risultati: tipo come nella maschera, valute escluse', () => {
    const hits = parseSearch({
      quotes: [
        { symbol: 'RACE.MI', shortname: 'FERRARI', quoteType: 'EQUITY', exchDisp: 'Milan', currency: 'EUR' },
        { symbol: 'VWCE.DE', longname: 'Vanguard FTSE All-World', quoteType: 'ETF', exchDisp: 'XETRA' },
        { symbol: 'EURUSD=X', quoteType: 'CURRENCY' },
        { symbol: 'BTC-USD', quoteType: 'CRYPTOCURRENCY', currency: 'USD' },
      ],
    })
    expect(hits.map(h => [h.ticker, h.tipoAsset, h.currency])).toEqual([
      ['RACE.MI', 'stock', 'EUR'],
      ['VWCE.DE', 'etf', 'EUR'],
      ['BTC-USD', 'crypto', 'USD'],
    ])
    expect(hits[1]!.name).toBe('Vanguard FTSE All-World')
    expect(parseSearch(null)).toEqual([])
  })

  it('indirizzo Yahoo con la ricerca codificata', () => {
    expect(searchUrl(' ferrari & co ')).toContain('q=ferrari%20%26%20co&')
  })
})
