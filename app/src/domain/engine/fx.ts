import type { FxLookup, Issue, RawTx } from './types.ts'

export const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''))
  return Number.isFinite(n) ? n : 0
}

const upper = (c: string | undefined, fallback = 'EUR') => (c || fallback).toUpperCase()

/**
 * Cambio da usare per un movimento: unità di `currency` per 1 EUR.
 * Ordine: EUR → 1; cambio salvato sul movimento (solo se è nella valuta del titolo);
 * cambio storico della data. Mai il cambio di oggi: se manca, è un problema da segnalare.
 */
export function rateFor(
  currency: string,
  tx: RawTx,
  assetCurrency: string,
  fx: FxLookup,
  issues: Issue[],
): number {
  const cur = upper(currency)
  if (cur === 'EUR') return 1
  if (cur === upper(assetCurrency)) {
    const saved = num(tx.exchangeRate)
    if (saved > 0) return saved
  }
  const hist = fx(cur, tx.date)
  if (hist && hist > 0) return hist
  issues.push({
    txId: tx.id,
    date: tx.date,
    code: 'cambio-mancante',
    message: `Cambio EUR/${cur} del ${tx.date} non disponibile`,
  })
  return NaN
}

/** Importi di un movimento già convertiti, nella valuta del titolo (native) e in EUR. */
export interface TxAmounts {
  qty: number
  price: number
  rate: number // valuta del titolo per 1 EUR
  grossNative: number
  grossEur: number
  commissionNative: number
  commissionEur: number
}

export function amounts(tx: RawTx, assetCurrency: string, fx: FxLookup, issues: Issue[]): TxAmounts {
  const qty = num(tx.qty)
  const price = num(tx.price)
  const rate = rateFor(assetCurrency, tx, assetCurrency, fx, issues)
  const grossNative = qty * price
  const grossEur = grossNative / rate

  const commission = num(tx.commission)
  const commCur = upper(tx.commissionCurrency)
  let commissionEur = 0
  if (commission) {
    commissionEur = commCur === 'EUR' ? commission : commission / rateFor(commCur, tx, assetCurrency, fx, issues)
  }
  return { qty, price, rate, grossNative, grossEur, commissionNative: commissionEur * rate, commissionEur }
}
