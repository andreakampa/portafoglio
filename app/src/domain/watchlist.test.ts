import { describe, expect, it } from 'vitest'
import { alertText, checkAlerts, parseWatchlistCsv, watchId, yahooSymbol, type WatchItem } from './watchlist.ts'

describe('avvisi di prezzo', () => {
  const item: WatchItem = { id: 'nvda', symbol: 'NVDA', above: 200, below: 150 }

  it('scatta una volta quando raggiunge la soglia e si riarma tornando indietro', () => {
    const a = checkAlerts([item], { NVDA: 201 })
    expect(a.hits).toEqual([{ id: 'nvda', symbol: 'NVDA', kind: 'above', threshold: 200, price: 201 }])
    expect(a.fired).toEqual({ nvda: { above: true, below: false } })
    // Ancora sopra: nessun nuovo avviso.
    expect(checkAlerts([{ ...item, fired: { above: true } }], { NVDA: 205 }).hits).toEqual([])
    // Torna sotto: si riarma senza avvisare.
    const back = checkAlerts([{ ...item, fired: { above: true } }], { NVDA: 190 })
    expect(back.hits).toEqual([])
    expect(back.fired).toEqual({ nvda: { above: false, below: false } })
  })

  it('soglia in basso, prezzo mancante ignorato, testo leggibile', () => {
    const a = checkAlerts([item, { id: 'x', symbol: 'X', below: 10 }], { NVDA: 149.5 })
    expect(a.hits.map(h => h.kind)).toEqual(['below'])
    expect(alertText(a.hits[0]!)).toBe('NVDA è sceso a 149,5 (soglia 150)')
  })
})

describe('importazione watchlist IBKR', () => {
  it('simboli IBKR → Yahoo', () => {
    expect(yahooSymbol('RACEm')).toBe('RACE.MI')
    expect(yahooSymbol('RACE', 'BVME')).toBe('RACE.MI')
    expect(yahooSymbol('SAP', 'IBIS')).toBe('SAP.DE')
    expect(yahooSymbol('BRK B', 'NYSE')).toBe('BRK-B')
    expect(yahooSymbol('nvda', 'NASDAQ')).toBe('NVDA')
    expect(yahooSymbol('PNG', 'VENTURE')).toBe('PNG.V')
  })

  it('CSV con intestazione (simbolo, borsa, descrizione) e senza doppioni', () => {
    const csv = 'Simbolo,Borsa,Descrizione\nNVDA,NASDAQ,NVIDIA CORP\nRACE,BVME,FERRARI NV\nnvda,NASDAQ,NVIDIA CORP\n'
    expect(parseWatchlistCsv(csv)).toEqual([
      { symbol: 'NVDA', name: 'NVIDIA CORP' },
      { symbol: 'RACE.MI', name: 'FERRARI NV' },
    ])
  })

  it('TWS "Financial Instrument" con borsa nel testo, e semplice elenco', () => {
    expect(parseWatchlistCsv('Financial Instrument,Last\n"SAP IBIS",120\nAAPL NASDAQ.NMS,190').map(r => r.symbol)).toEqual(['SAP.DE', 'AAPL'])
    expect(parseWatchlistCsv('NVDA\nAMD;\nRACE.MI').map(r => r.symbol)).toEqual(['NVDA', 'AMD', 'RACE.MI'])
  })

  it('id per Firebase', () => {
    expect(watchId('race.mi')).toBe('RACE_MI')
  })
})
