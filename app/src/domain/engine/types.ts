// Tipi del motore di calcolo. I movimenti sono quelli salvati su Firebase dal sito
// attuale (users/{uid}/portfolio_state/portfolios/{id}/assets/{id}/transactions).

export type TaxRegime = 'amministrato' | 'dichiarativo'

/** Come si sceglie il costo di ciò che si vende. */
export type CostMethod =
  | 'average' // costo medio ponderato (regime amministrato)
  | 'lifo' // ultimo entrato primo uscito (regime dichiarativo, presunzione di legge)
  | 'fifo' // primo entrato primo uscito: non è un metodo fiscale italiano, serve per confrontarsi con IBKR

export type TxType = 'buy' | 'sell' | 'transfer' | 'short_sell' | 'buy_to_cover'

export interface LotAllocation {
  lotId: string
  qty: number
}

export interface RawTx {
  id?: string
  date: string // YYYY-MM-DD
  type: TxType | string
  qty: number | string
  price: number | string
  commission?: number | string
  /** Valuta della commissione. Se assente: EUR (comportamento storico del sito). */
  commissionCurrency?: string
  /** Unità di valuta del titolo per 1 EUR, alla data del movimento (es. 1.08 USD). */
  exchangeRate?: number | string
  /** Lega tra loro l'uscita e l'entrata dello stesso trasferimento tra portafogli. */
  transferId?: string
  /** Trasferimento in uscita verso questo portafoglio. */
  destPortfolioId?: string
  /** Trasferimento in entrata da questo portafoglio. */
  sourcePortfolioId?: string
  lotAllocation?: LotAllocation[]
  marginAmount?: number
  /** Id dell'ordine IBKR (`ordine@data`) per i movimenti importati: evita i doppioni. */
  externalId?: string
  source?: string
}

export type AssetType = 'stock' | 'etf' | 'fondo' | 'bond' | 'crypto' | string

export interface RawAsset {
  nome?: string
  ticker?: string
  valuta?: string
  tipoAsset?: AssetType
  transactions?: RawTx[]
}

/** Cambio storico: unità di `currency` per 1 EUR alla data, o undefined se non noto. */
export type FxLookup = (currency: string, date: string) => number | undefined

/** Problema nei dati che rende un risultato non affidabile: va mostrato, mai nascosto. */
export interface Issue {
  txId?: string
  date?: string
  code: 'cambio-mancante' | 'vendita-oltre-quantita' | 'lotto-inesistente' | 'quantita-non-valida' | 'trasferimento-non-collegato'
  message: string
}
