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
  { key: 'option', label: 'Opzione (quantità = contratti × 100, prezzo = premio per azione)' },
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

// ── Modifica ed eliminazione di un trasferimento (le due metà insieme) ─────────

export type PortfolioLike = { name?: string; assets?: Record<string, RawAsset> }

export interface TxLocation {
  pid: string
  aid: string
  index: number
  tx: RawTx
}

/** Le due metà di un trasferimento, cercate in tutti i portafogli per `transferId`. Una può mancare (dati vecchi). */
export function findTransfer(portfolios: Record<string, PortfolioLike>, transferId: string): { out?: TxLocation; in?: TxLocation } {
  const found: { out?: TxLocation; in?: TxLocation } = {}
  for (const [pid, p] of Object.entries(portfolios)) {
    for (const [aid, a] of Object.entries(p.assets ?? {})) {
      ;(a.transactions ?? []).forEach((tx, index) => {
        if (tx?.type !== 'transfer' || tx.transferId !== transferId) return
        found[tx.sourcePortfolioId ? 'in' : 'out'] = { pid, aid, index, tx }
      })
    }
  }
  return found
}

/** Quantità posseduta (long) secondo i movimenti, escluso il movimento indicato. */
export function heldQty(txs: RawTx[], skip?: RawTx): number {
  let q = 0
  for (const t of txs) {
    if (t === skip) continue
    const n = Number(t.qty) || 0
    if (t.type === 'buy') q += n
    else if (t.type === 'sell') q -= n
    else if (t.type === 'transfer') q += t.sourcePortfolioId ? n : -n
  }
  return q
}

/**
 * Scritture per correggere (nuova data e quantità) o eliminare un trasferimento: percorso Firebase
 * `{pid}/assets/{aid}/transactions` → nuovo elenco dei movimenti. Le due metà cambiano insieme.
 */
export function transferWrites(
  portfolios: Record<string, PortfolioLike>,
  pair: { out?: TxLocation; in?: TxLocation },
  change: { remove: true } | { form: TransferForm },
): Record<string, RawTx[]> {
  const writes: Record<string, RawTx[]> = {}
  for (const half of [pair.out, pair.in]) {
    if (!half) continue
    const path = `${half.pid}/assets/${half.aid}/transactions`
    const list = writes[path] ?? [...(portfolios[half.pid]?.assets?.[half.aid]?.transactions ?? [])]
    const i = list.findIndex(t => t === half.tx || (half.tx.id && t.id === half.tx.id))
    if (i < 0) throw new Error('Il trasferimento è cambiato nel frattempo (forse da un altro dispositivo): chiudi e riprova.')
    if ('remove' in change) list.splice(i, 1)
    else list[i] = { ...list[i]!, date: change.form.date, qty: num(change.form.qty) }
    writes[path] = sortByDate(list)
  }
  return writes
}

// ── Opzione esercitata o assegnata (inserimento a mano) ───────────────────────

/** Call o put dal ticker OCC dell'app (es. BMEA280121C00001500); null se non si riconosce. */
export function optionKind(ticker: string | undefined): 'call' | 'put' | null {
  const m = /\d{6}([CP])\d{8}$/.exec((ticker ?? '').toUpperCase())
  return m ? (m[1] === 'C' ? 'call' : 'put') : null
}

/** Prezzo d'esercizio dal ticker OCC (le ultime 8 cifre sono lo strike × 1000). */
export function optionStrike(ticker: string | undefined): number | null {
  const m = /\d{6}[CP](\d{8})$/.exec((ticker ?? '').toUpperCase())
  return m ? Number(m[1]) / 1000 : null
}

/**
 * Le due metà di un esercizio/assegnazione: chiusura dell'opzione (tipo exercise) e movimento del sottostante
 * al prezzo d'esercizio, collegati dallo stesso exerciseId. `held` = contratti posseduti con segno (× 100):
 * positivo = opzione comprata (si esercita), negativo = venduta (si viene assegnati).
 * Call comprata o put venduta → si comprano le azioni; put comprata o call venduta → si vendono.
 */
export function buildExercise(
  kind: 'call' | 'put',
  held: number,
  f: { date: string; qty: string; strike: string },
  newId: () => string,
): { option: RawTx; stock: RawTx } {
  const exerciseId = 'X' + newId()
  const q = num(f.qty)
  const long = held > 0
  const buys = (kind === 'call') === long
  return {
    option: { id: newId(), date: f.date, type: 'exercise', qty: q, price: 0, commission: 0, exerciseId },
    stock: { id: newId(), date: f.date, type: buys ? 'buy' : 'sell', qty: q, price: num(f.strike), commission: 0, exerciseId },
  }
}

/**
 * Motivo per cui un titolo non si può eliminare dalla tabella, o null se si può.
 * I trasferimenti sono legati a un movimento in un altro portafoglio: eliminarli da una parte sola romperebbe il costo dell'altra.
 */
export function deleteAssetBlock(asset: { transactions?: { type?: string; transferId?: string }[] } | undefined): string | null {
  const linked = (asset?.transactions ?? []).some(t => t.type === 'transfer' || !!t.transferId)
  return linked ? 'Questo titolo ha trasferimenti collegati a un altro portafoglio: elimina prima il trasferimento da Movimenti.' : null
}
