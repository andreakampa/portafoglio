import { describe, expect, it } from 'vitest'
import { newPortfolio, newPortfolioId, summarizePortfolios } from './portfolioState'

describe('summarizePortfolios', () => {
  it('restituisce un elenco vuoto senza dati', () => {
    expect(summarizePortfolios(null)).toEqual([])
    expect(summarizePortfolios({})).toEqual([])
  })

  it('conta titoli e movimenti e mette prima il portafoglio attivo', () => {
    const list = summarizePortfolios({
      activePortfolioId: 'tr',
      portfolios: {
        ibkr: {
          id: 'ibkr',
          name: 'IBKR',
          taxRegime: 'dichiarativo',
          assets: {
            a: { transactions: [{ date: '2026-01-02', type: 'buy', qty: 1, price: 10 }] },
            b: { transactions: [] },
          },
        },
        tr: {
          id: 'tr',
          name: 'Trade Republic',
          taxRegime: 'amministrato',
          assets: { c: { transactions: [{ date: '2026-01-02', type: 'buy', qty: 2, price: 5 }, { date: '2026-02-02', type: 'sell', qty: 1, price: 6 }] } },
        },
      },
    })
    expect(list.map(p => [p.name, p.active, p.assets, p.transactions, p.taxRegime])).toEqual([
      ['Trade Republic', true, 1, 2, 'amministrato'],
      ['IBKR', false, 2, 1, 'dichiarativo'],
    ])
  })

  it('regge dati incompleti salvati da versioni vecchie', () => {
    const list = summarizePortfolios({
      portfolios: { x: { id: '', name: '  ' } as never, y: { id: 'y', assets: { z: {} } } },
    })
    expect(list).toHaveLength(2)
    expect(list.every(p => p.name === 'Portafoglio senza nome' && p.taxRegime === 'amministrato')).toBe(true)
    expect(list.find(p => p.id === 'y')?.assets).toBe(1)
  })
})

describe('nuovo portafoglio', () => {
  it('formato del sito attuale, nome di riserva', () => {
    expect(newPortfolio('  Fineco ', 'amministrato', 'P1')).toEqual({ id: 'P1', name: 'Fineco', taxRegime: 'amministrato', assets: {}, fiscal: { manualLosses: [] } })
    expect(newPortfolio('', 'dichiarativo', 'P2').name).toBe('Portafoglio')
    expect(newPortfolioId(1700000000000)).toBe('P1700000000000')
  })
})
