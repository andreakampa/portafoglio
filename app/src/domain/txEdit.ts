// Inserimento e modifica dei movimenti: funzioni pure, senza Firebase (si provano con i test).
// I movimenti restano nel formato del sito attuale, così i due siti convivono sugli stessi dati.

import type { RawAsset, RawTx } from './engine/types.ts'

export type EditableType = 'buy' | 'sell' | 'short_sell' | 'buy_to_cover'

export const EDITABLE_LABEL: Record<EditableType, string> = {
  buy: 'Acquisto',
  sell: 'Vendita',
  short_sell: 'Apertura short',
  buy_to_cover: 'Chiusura short',
}

/** Dati della maschera, come li scrive l'utente (testi). */
export interface TxForm {
  type: EditableType
  date: string
  qty: string
  price: string
  commission: string
  commissionCurrency: string
  /** Rata di un piano di accumulo: è un acquisto segnato come PAC. */
  pac: boolean
}

/** Come ritrovare un movimento nell'elenco: per id, altrimenti per posizione controllando che sia lo stesso. */
export interface TxRef {
  id?: string
  index: number
  date: string
  type: string
}

const num = (s: string) => Number(s.trim().replace(',', '.'))

export function validateTx(f: TxForm, today: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date) || Number.isNaN(Date.parse(f.date))) return 'Scegli la data.'
  if (f.date > today) return 'La data non può essere nel futuro.'
  const qty = num(f.qty)
  if (!f.qty.trim() || !Number.isFinite(qty) || qty <= 0) return 'La quantità deve essere maggiore di zero.'
  const price = num(f.price)
  if (!f.price.trim() || !Number.isFinite(price) || price < 0) return 'Il prezzo non è valido.'
  if (f.commission.trim()) {
    const c = num(f.commission)
    if (!Number.isFinite(c) || c < 0) return 'Le commissioni non sono valide.'
  }
  return null
}

/** Movimento da salvare. Con `previous` si conservano i campi che la maschera non conosce (id, margine, id IBKR…). */
export function buildTx(f: TxForm, newId: () => string, previous?: RawTx): RawTx {
  const commission = f.commission.trim() ? num(f.commission) : 0
  const tx: RawTx = {
    ...previous,
    id: previous?.id ?? newId(),
    date: f.date,
    type: f.type,
    qty: num(f.qty),
    price: num(f.price),
    commission,
    commissionCurrency: f.commissionCurrency.toUpperCase(),
  }
  if (f.pac && f.type === 'buy') tx.source = 'pac'
  else if (tx.source === 'pac') delete tx.source
  // Salvando la maschera l'utente conferma il prezzo: non è più una stima.
  delete tx.priceEstimated
  // I cambi storici li mette il motore: un cambio rimasto da un vecchio inserimento non deve falsare il nuovo prezzo.
  if (previous && (previous.date !== f.date || +previous.price !== tx.price)) delete tx.exchangeRate
  return tx
}

export function formFromTx(t: RawTx, assetCurrency: string): TxForm {
  const type = (['buy', 'sell', 'short_sell', 'buy_to_cover'].includes(String(t.type)) ? t.type : 'buy') as EditableType
  return {
    type,
    date: t.date,
    qty: String(t.qty),
    price: String(t.price),
    commission: t.commission ? String(t.commission) : '',
    commissionCurrency: (t.commissionCurrency || 'EUR').toUpperCase() || assetCurrency,
    pac: t.source === 'pac',
  }
}

const sortByDate = (l: RawTx[]) => l.sort((a, b) => a.date.localeCompare(b.date)) // stabile: a pari data resta l'ordine di inserimento

export function addToList(list: RawTx[] | null | undefined, tx: RawTx): RawTx[] {
  return sortByDate([...(list ?? []), tx])
}

/** Posizione del movimento nell'elenco, o -1 se nel frattempo è cambiato (es. modificato da un altro dispositivo). */
export function locate(list: RawTx[], ref: TxRef): number {
  if (ref.id) return list.findIndex(t => t.id === ref.id)
  const t = list[ref.index]
  return t && t.date === ref.date && t.type === ref.type ? ref.index : -1
}

export function replaceInList(list: RawTx[], ref: TxRef, tx: RawTx): RawTx[] | null {
  const i = locate(list, ref)
  if (i < 0) return null
  const next = [...list]
  next[i] = tx
  return sortByDate(next)
}

export function removeFromList(list: RawTx[], ref: TxRef): RawTx[] | null {
  const i = locate(list, ref)
  return i < 0 ? null : list.filter((_, k) => k !== i)
}

// ── Titoli nuovi ──────────────────────────────────────────────────────────────

export interface NewAssetForm {
  ticker: string
  nome: string
  valuta: string
  tipoAsset: string
  isin: string
}

export const ASSET_TYPES = [
  { key: 'stock', label: 'Azione' },
  { key: 'etf', label: 'ETF' },
  { key: 'fondo', label: 'Fondo' },
  { key: 'bond', label: 'Titolo di Stato / obbligazione' },
  { key: 'crypto', label: 'Crypto' },
]

export function validateNewAsset(f: NewAssetForm): string | null {
  if (!f.ticker.trim()) return 'Scrivi il ticker (quello di Yahoo, es. NVDA o RACE.MI).'
  if (!/^[A-Za-z]{3}$/.test(f.valuta.trim())) return 'La valuta ha tre lettere (es. EUR, USD).'
  return null
}

/** Chiave Firebase del titolo: niente `. $ # [ ] /`. */
export const assetKey = (ticker: string) => ticker.trim().toUpperCase().replace(/[.$#[\]/]/g, '_')

export function buildAsset(f: NewAssetForm): RawAsset & { isin?: string; commDefault?: number } {
  const ticker = f.ticker.trim().toUpperCase()
  return {
    nome: f.nome.trim() || ticker,
    ticker,
    valuta: f.valuta.trim().toUpperCase(),
    tipoAsset: f.tipoAsset,
    ...(f.isin.trim() ? { isin: f.isin.trim().toUpperCase() } : {}),
    commDefault: 0,
    transactions: [],
  }
}

// ── Trasferimento tra portafogli ──────────────────────────────────────────────

export interface TransferForm {
  date: string
  qty: string
}

export function validateTransfer(f: TransferForm, available: number, today: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date) || Number.isNaN(Date.parse(f.date))) return 'Scegli la data.'
  if (f.date > today) return 'La data non può essere nel futuro.'
  const q = num(f.qty)
  if (!f.qty.trim() || !Number.isFinite(q) || q <= 0) return 'La quantità deve essere maggiore di zero.'
  if (q > available + 1e-9) return `Hai solo ${available} da trasferire.`
  return null
}

/** Le due metà di un trasferimento, collegate dallo stesso `transferId`. `price` = costo medio in valuta del titolo. */
export function buildTransferPair(
  f: TransferForm,
  price: number,
  fromPortfolioId: string,
  toPortfolioId: string,
  newId: () => string,
): { out: RawTx; in: RawTx } {
  const transferId = 'T' + newId()
  const common = { date: f.date, type: 'transfer', qty: num(f.qty), price, commission: 0, transferId }
  return {
    out: { ...common, id: newId(), destPortfolioId: toPortfolioId },
    in: { ...common, id: newId(), sourcePortfolioId: fromPortfolioId },
  }
}

/** Cerca nel portafoglio di destinazione lo stesso titolo (per ISIN o ticker), come fa il sito attuale. */
export function findSameAsset(
  assets: Record<string, RawAsset & { isin?: string }> | undefined,
  src: RawAsset & { isin?: string },
): string | undefined {
  const t = (src.ticker || src.nome || '').toUpperCase()
  const isin = (src.isin || '').toUpperCase()
  return Object.entries(assets ?? {}).find(([, a]) => {
    const at = (a.ticker || a.nome || '').toUpperCase()
    return (isin && (a.isin || '').toUpperCase() === isin) || (t && at === t)
  })?.[0]
}
