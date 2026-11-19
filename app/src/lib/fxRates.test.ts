import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadFx, parseBdi } from './fxRates'
import { parseYahoo } from './prices'

beforeEach(() => localStorage.clear())

describe('cambi Banca d’Italia', () => {
  it('legge il formato della risposta', () => {
    expect(parseBdi({ rates: [{ isoCode: 'USD', avgRate: '1.1641' }, { isoCode: 'CAD', avgRate: '1.5777' }] })).toEqual({ USD: 1.1641, CAD: 1.5777 })
    expect(parseBdi({ rates: [] })).toBeNull()
  })

  it('nei festivi risale al giorno lavorativo precedente e mette in cache', async () => {
    const fetchDay = vi.fn(async (d: string) => (d === '2026-03-06' ? { USD: 1.15 } : null))
    const fx = await loadFx(['2026-03-08'], fetchDay) // domenica → venerdì 6
    expect(fx('USD', '2026-03-08')).toBe(1.15)
    expect(fx('CAD', '2026-03-08')).toBeUndefined()
    expect(fetchDay.mock.calls.map(c => c[0])).toEqual(['2026-03-08', '2026-03-07', '2026-03-06'])

    const again = vi.fn()
    const fx2 = await loadFx(['2026-03-08'], again)
    expect(again).not.toHaveBeenCalled()
    expect(fx2('usd', '2026-03-08')).toBe(1.15)
  })

  it('un errore di rete non viene salvato come festivo', async () => {
    const failing = vi.fn(async () => {
      throw new Error('rete')
    })
    await loadFx(['2026-03-10'], failing)
    const ok = vi.fn(async () => ({ USD: 1.2 }))
    const fx = await loadFx(['2026-03-10'], ok)
    expect(fx('USD', '2026-03-10')).toBe(1.2)
  })

  it('non chiede date future o malformate', async () => {
    const fetchDay = vi.fn(async () => ({ USD: 1 }))
    await loadFx(['2999-01-01', 'ieri', ''], fetchDay)
    expect(fetchDay).not.toHaveBeenCalled()
  })
})

describe('prezzi Yahoo', () => {
  it('estrae prezzo, chiusura precedente e valuta', () => {
    const q = parseYahoo({ chart: { result: [{ meta: { symbol: 'AAPL', regularMarketPrice: 210.5, chartPreviousClose: 200, currency: 'USD', regularMarketTime: 1 } }] } })
    expect(q).toEqual({ symbol: 'AAPL', price: 210.5, previousClose: 200, currency: 'USD', time: 1000 })
    expect(parseYahoo({ chart: { result: [] } })).toBeNull()
  })
})
