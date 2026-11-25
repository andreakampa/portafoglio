import { describe, expect, it } from 'vitest'
import { alertText, checkAlerts, listCounts, mergeIbkrWatchlists, planQuotes, parseWatchlistCsv, watchId, yahooSymbol, type WatchItem } from './watchlist.ts'

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

describe('allineamento con IBKR', () => {
  const existing: WatchItem[] = [
    { id: 'NVDA', symbol: 'NVDA', source: 'ibkr', lists: ['Semiconductor'], above: 200, note: 'mia nota' },
    { id: 'OLD', symbol: 'OLD', source: 'ibkr', lists: ['Spazio'] },
    { id: 'MIO', symbol: 'MIO', note: 'aggiunto a mano' },
    { id: 'GONE', symbol: 'GONE', source: 'ibkr', goneFromIbkr: true, lists: ['X'] },
  ]
  it('aggiunge i nuovi, aggiorna solo le liste, non cancella mai', () => {
    const r = mergeIbkrWatchlists(existing, [
      { symbol: 'NVDA', ibkrSymbol: 'NVDA', lists: ['Watchlist', 'Semiconductor'] },
      { symbol: 'UCG.MI', ibkrSymbol: 'UCG', name: 'UniCredit', lists: ['Finance'] },
      { symbol: 'GONE', ibkrSymbol: 'GONE', lists: ['X'] },
    ], '2026-11-29T20:00:00Z')
    expect(r.added).toEqual(['UCG.MI'])
    expect(r.updated).toEqual(['NVDA', 'GONE'])
    expect(r.gone).toEqual(['OLD'])
    expect(r.writes).toEqual({
      'NVDA/lists': ['Semiconductor', 'Watchlist'],
      UCG_MI: { symbol: 'UCG.MI', name: 'UniCredit', source: 'ibkr', ibkrSymbol: 'UCG', lists: ['Finance'], addedAt: '2026-11-29T20:00:00Z' },
      'GONE/lists': ['X'],
      'GONE/goneFromIbkr': null,
      'OLD/goneFromIbkr': true,
    })
    // Soglie, note e titoli aggiunti a mano: nessuna scrittura.
    expect(Object.keys(r.writes).some(k => k.startsWith('MIO') || k.endsWith('/above') || k.endsWith('/note'))).toBe(false)
  })

  it('niente da fare se è tutto uguale', () => {
    expect(mergeIbkrWatchlists([{ id: 'A', symbol: 'A', source: 'ibkr', lists: ['L'] }], [{ symbol: 'A', ibkrSymbol: 'A', lists: ['L'] }], 'x').writes).toEqual({})
  })

  it('conteggio per lista', () => {
    expect(listCounts(existing)).toEqual([{ name: 'Semiconductor', count: 1 }, { name: 'Spazio', count: 1 }, { name: 'X', count: 1 }])
  })
})

describe('planQuotes: avvisi entro il limite di Cloudflare', () => {
  it('tutti i titoli se ci stanno, una volta sola anche se in più watchlist', () => {
    expect(planQuotes(['MSFT', 'AAPL', 'MSFT'], 0, 10)).toEqual({ batch: ['AAPL', 'MSFT'], next: 0 })
  })
  it('a turno quando sono troppi, senza saltarne nessuno', () => {
    const s = ['A', 'B', 'C', 'D', 'E']
    const r1 = planQuotes(s, 0, 2)
    const r2 = planQuotes(s, r1.next, 2)
    const r3 = planQuotes(s, r2.next, 2)
    expect([r1.batch, r2.batch, r3.batch]).toEqual([['A', 'B'], ['C', 'D'], ['E', 'A']])
    expect(r3.next).toBe(1)
  })
  it('cursore fuori misura (titoli tolti) riparte da capo', () => {
    expect(planQuotes(['A', 'B', 'C'], 7, 2).batch).toEqual(['A', 'B'])
  })
  it('budget esaurito: niente', () => {
    expect(planQuotes(['A'], 0, -3)).toEqual({ batch: [], next: 0 })
  })
})
