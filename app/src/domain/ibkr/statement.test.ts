import { describe, expect, it } from 'vitest'
import { checkStatement, occSymbol, parseCsvLine, parseStatement, summarizeStatement } from './statement.ts'

// Rendiconto inventato, con la stessa struttura del CSV IBKR in italiano.
const CSV = [
  '﻿Statement,Header,Nome campo,Valore campo',
  'Statement,Data,BrokerName,Interactive Brokers Ireland Limited',
  'Statement,Data,Period,"Gennaio 1, 2026 - Dicembre 31, 2026"',
  'Valore patrimoniale netto,Header,Classe di asset,Totale precedente,Long attuale,Short attuale,Totale corrente,Variazione',
  'Valore patrimoniale netto,Data,Liquidità,0,0,-500,-500,-500',
  'Dettaglio eseguiti,Header,DataDiscriminator,Tipo di attivo,Valuta,Simbolo,Data/ora,Quantità,Prezzo eseguito,Prezzo di chiusura,Ricavo,Comm./tasse,Base,P/L realizzato,P/L MTM,Codice',
  'Dettaglio eseguiti,Data,Order,Azioni,USD,MSFT,"2026-03-02, 10:00:00",10,400,401,-4000,-1,4001,0,10,O',
  'Dettaglio eseguiti,Data,Order,Azioni,USD,MSFT,"2026-03-02, 11:00:00",5,401,401,-2005,-1,2006,0,0,O',
  'Dettaglio eseguiti,Data,Order,Azioni,EUR,RACEm,"2026-04-02, 10:00:00","-1,000",3,3,3000,-2,,50,0,C',
  'Dettaglio eseguiti,SubTotal,,Azioni,USD,MSFT,,15,,,-6005,-2,6007,0,10,',
  'Dettaglio eseguiti,Data,Order,Opzioni su indici e su azioni,USD,BMEA 21JAN28 1.5 C,"2026-08-26, 09:34:03",1,1,1.2,-100,0.14,99.86,0,20,O',
  'Dettaglio eseguiti,Header,DataDiscriminator,Tipo di attivo,Valuta,Simbolo,Data/ora,Quantità,Prezzo eseguito,,Ricavo,Comm in EUR,,,MTM in EUR,Codice',
  'Dettaglio eseguiti,Data,Order,Forex,USD,EUR.USD,"2026-03-01, 10:00:00",5000,1.1,,-5500,-2,,,0,',
  'Dividendi,Header,Valuta,Data,Descrizione,Importo',
  'Dividendi,Data,USD,2026-06-11,MSFT(US5949181045) Dividendo in contanti USD 0.91 per azione (Dividendo ordinario),13.65',
  'Dividendi,Data,Totale,,,13.65',
  'Ritenute alla fonte,Header,Valuta,Data,Descrizione,Importo,Codice',
  'Ritenute alla fonte,Data,USD,2026-06-11,MSFT(US5949181045) Dividendo in contanti USD 0.91 per azione - US Imposta,-2.05,',
  'Interessi,Header,Valuta,Data,Descrizione,Importo',
  'Interessi,Data,USD,2026-07-03,USD Interessi debitori per Giu-2026,-20',
  'Interessi,Data,USD,2026-07-03,USD Interesse su titoli gestiti da IBKR (SYEP) per Giu-2026,1.5',
  'Interessi,Data,EUR,2026-10-05,EUR Interesse creditori per Sett-2026,0.2',
  'Posizioni aperte,Header,DataDiscriminator,Tipo di attivo,Valuta,Simbolo,Apertura,Quantità,Molt,Costo,Prezzo di costo,Prezzo di chiusura,Valore,P/L non realizzato,Codice',
  'Posizioni aperte,Data,Summary,Azioni,USD,MSFT,-,15,1,400.4,6007,480,7200,1193,',
  'Posizioni aperte,Data,Summary,Opzioni su indici e su azioni,USD,BMEA 21JAN28 1.5 C,-,1,100,0.99,99.86,0.5,50,-49.86,',
  'Posizioni aperte,Data,Summary,Azioni,USD,IBKR,-,0.5,1,0,0,80,40,40,',
  'Informazioni sullo strumento finanziario,Header,Tipo di attivo,Simbolo,Descrizione,Conid,ID titolo,Sottostante,Mercato finanziario,Moltiplicatore,Tipo,Codice',
  'Informazioni sullo strumento finanziario,Data,Azioni,MSFT,MICROSOFT CORP,272093,US5949181045,MSFT,NASDAQ,1,COMMON,',
  'Informazioni sullo strumento finanziario,Data,Azioni,RACEm,FERRARI NV,1,NL0011585146,RACE,BVME,1,COMMON,',
].join('\r\n')

const assets = {
  ms: { ticker: 'MSFT', isin: 'US5949181045', valuta: 'USD', transactions: [{ date: '2026-03-02', type: 'buy', qty: 15, price: 400 }] },
  fe: { ticker: 'RACE.MI', valuta: 'EUR', transactions: [{ date: '2025-01-02', type: 'buy', qty: 1000, price: 2 }, { date: '2026-04-02', type: 'sell', qty: 900, price: 3 }] },
  op: { ticker: 'BMEA280121C00001500', valuta: 'USD', tipoAsset: 'option', transactions: [{ date: '2026-08-26', type: 'buy', qty: 100, price: 1 }] },
}

describe('rendiconto IBKR', () => {
  it('legge righe con virgole tra virgolette', () => {
    expect(parseCsvLine('a,"1,000",b')).toEqual(['a', '1,000', 'b'])
  })

  it('legge periodo, operazioni (senza forex), dividendi, ritenute, interessi, posizioni', () => {
    const st = parseStatement(CSV)
    expect(st).toMatchObject({ from: '2026-01-01', to: '2026-12-31', endCash: -500 })
    expect(st.trades).toHaveLength(4)
    expect(st.trades[2]).toMatchObject({ symbol: 'RACEm', qty: -1000, commission: 2, realizedPL: 50 })
    expect(st.dividends).toEqual([expect.objectContaining({ symbol: 'MSFT', isin: 'US5949181045', amount: 13.65 })])
    expect(st.withholdings[0]!.amount).toBe(-2.05)
    expect(st.interest.map(i => i.kind)).toEqual(['debit', 'syep', 'credit'])
    expect(st.positions).toHaveLength(3)
    expect(st.instruments.MSFT!.isin).toBe('US5949181045')
  })

  it('rifiuta un file che non è un rendiconto IBKR', () => {
    expect(() => parseStatement('a,b,c\n1,2,3')).toThrow(/rendiconto/)
  })

  it('opzioni: simbolo IBKR → ticker OCC', () => {
    expect(occSymbol('BMEA 21JAN28 1.5 C')).toBe('BMEA280121C00001500')
    expect(occSymbol('MSFT')).toBeNull()
  })

  it('confronto: trova solo le differenze', () => {
    const st = parseStatement(CSV)
    const c = checkStatement(st, assets, [
      { date: '2026-06-11', kind: 'dividend', currency: 'USD', amount: 13.65 },
      { date: '2026-06-11', kind: 'withholding', currency: 'USD', amount: -2.05 },
      { date: '2026-07-03', kind: 'lending', currency: 'USD', amount: 1.5 },
    ])
    expect(c.yearEnd).toBe(true)
    // RACE: il rendiconto vende 1000, l'app 900.
    expect(c.trades).toEqual([expect.objectContaining({ symbol: 'RACEm', assetId: 'fe', statementQty: -1000, appQty: -900 })])
    // Interessi attivi EUR mancanti nell'app.
    expect(c.cash).toEqual([{ kind: 'interessi attivi', currency: 'EUR', statement: 0.2, app: 0 }])
    // IBKR nel conto ma non nell'app; RACE: 100 nell'app, 0 nel rendiconto.
    expect(c.positions).toEqual(expect.arrayContaining([
      expect.objectContaining({ symbol: 'IBKR', assetId: null, statementQty: 0.5 }),
      expect.objectContaining({ assetId: 'fe', statementQty: 0, appQty: 100 }),
    ]))
    expect(c.positions).toHaveLength(2)
  })

  it('riassunto da salvare: prezzi di chiusura per titolo dell’app', () => {
    const s = summarizeStatement(parseStatement(CSV), assets, '2027-01-10T10:00:00Z')
    expect(s.closes).toEqual({ ms: 480, op: 0.5 })
  })
})
