import { num } from './fx.ts'
import type { PortfolioResult, RawPortfolio } from './portfolio.ts'
import { symbolOf } from './valuation.ts'

export type MovementKind = 'buy' | 'sell' | 'short_sell' | 'buy_to_cover' | 'transfer_in' | 'transfer_out'

export const KIND_LABEL: Record<MovementKind, string> = {
  buy: 'Acquisto',
  sell: 'Vendita',
  short_sell: 'Apertura short',
  buy_to_cover: 'Chiusura short',
  transfer_in: 'Trasferimento in entrata',
  transfer_out: 'Trasferimento in uscita',
}

export interface Movement {
  key: string
  assetId: string
  symbol: string
  date: string
  kind: MovementKind
  qty: number
  /** Prezzo di negoziazione, nella valuta del titolo. */
  price: number
  currency: string
  /** Controvalore lordo nella valuta del titolo. */
  gross: number
  commission: number
  commissionCurrency: string
  marginAmount: number
  /** Plus/minus in EUR, solo per vendite e chiusure di short. */
  gainEur: number | null
  /** Posizione del movimento nei dati, per modificarlo o eliminarlo. */
  txId?: string
  index: number
  /** Importato da IBKR (ha un id dell'ordine): una modifica o eliminazione va fatta con cautela. */
  fromBroker: boolean
  pac: boolean
  /** Prezzo preso dalla chiusura di borsa: da confermare con l'esecuzione vera. */
  estimated: boolean
}

/** Tutti i movimenti di un portafoglio, dal più recente, con il risultato delle chiusure. */
export function buildMovements(p: RawPortfolio, result: PortfolioResult): Movement[] {
  const out: Movement[] = []
  for (const [assetId, a] of Object.entries(p.assets ?? {})) {
    const currency = (a.valuta || 'EUR').toUpperCase()
    const realized = result.positions[assetId]?.realized ?? []
    ;(a.transactions ?? []).forEach((t, i) => {
      const kind: MovementKind | null =
        t.type === 'transfer' ? (t.sourcePortfolioId ? 'transfer_in' : 'transfer_out')
        : t.type === 'buy' || t.type === 'sell' || t.type === 'short_sell' || t.type === 'buy_to_cover' ? t.type
        : null
      if (!kind || !t.date) return
      const qty = num(t.qty)
      const price = num(t.price)
      // Le chiusure si collegano all'evento realizzato tramite l'id del movimento.
      const ev = t.id ? realized.find(e => e.txId === t.id) : undefined
      out.push({
        key: `${assetId}#${t.id ?? i}`,
        assetId,
        symbol: symbolOf(a, assetId),
        date: t.date,
        kind,
        qty,
        price,
        currency,
        gross: qty * price,
        commission: num(t.commission),
        commissionCurrency: (t.commissionCurrency || 'EUR').toUpperCase(),
        marginAmount: num(t.marginAmount),
        gainEur: ev ? ev.gainEur : null,
        txId: t.id,
        index: i,
        fromBroker: !!t.externalId,
        pac: t.source === 'pac',
        estimated: !!t.priceEstimated,
      })
    })
  }
  return out.sort((x, y) => y.date.localeCompare(x.date) || x.symbol.localeCompare(y.symbol))
}

export type Period = '1m' | '3m' | 'ytd' | '12m' | 'all' | `${number}`

/** Data minima (inclusa) e massima (esclusa) di un periodo, rispetto a `today`. */
export function periodRange(period: Period, today: string): [string, string] {
  const end = '9999-12-31'
  const shift = (months: number) => {
    const d = new Date(today + 'T12:00:00Z')
    d.setUTCMonth(d.getUTCMonth() - months)
    return d.toISOString().slice(0, 10)
  }
  switch (period) {
    case '1m': return [shift(1), end]
    case '3m': return [shift(3), end]
    case '12m': return [shift(12), end]
    case 'ytd': return [`${today.slice(0, 4)}-01-01`, end]
    case 'all': return ['0000-01-01', end]
    default: return [`${period}-01-01`, `${Number(period) + 1}-01-01`]
  }
}

export interface MarginInterestRow {
  id?: string
  period: string // YYYY-MM
  currency: string
  amount: number
}

export function marginInterest(p: RawPortfolio & { marginInterest?: MarginInterestRow[] }): MarginInterestRow[] {
  return [...(p.marginInterest ?? [])]
    .filter(r => r && r.period)
    .map(r => ({ ...r, amount: num(r.amount), currency: (r.currency || 'EUR').toUpperCase() }))
    .sort((a, b) => b.period.localeCompare(a.period))
}

export type CashKind = 'dividend' | 'pil' | 'withholding' | 'margin-interest' | 'credit-interest' | 'lending' | 'fee'

export const CASH_LABEL: Record<CashKind, string> = {
  dividend: 'Dividendo',
  pil: 'Pagamento sostitutivo',
  withholding: 'Ritenuta',
  'margin-interest': 'Interesse di margine',
  'credit-interest': 'Interesse attivo',
  lending: 'Prestito titoli',
  fee: 'Commissione',
}

export interface CashflowItem {
  id: string
  date: string
  kind: CashKind
  symbol: string
  currency: string
  amount: number
  description: string
  /** Cambio del giorno salvato dalla sincronizzazione (unità di valuta per 1 EUR). */
  exchangeRate?: number
}

export interface CashTotal {
  kind: CashKind
  currency: string
  amount: number
}

/** Movimenti di cassa (dividendi, ritenute, interessi...) nel periodo [from, to), dal più recente. Importi con segno, nella valuta originale. */
export function cashflowsIn(
  p: { cashflows?: Partial<CashflowItem>[] },
  from: string,
  to: string,
): { items: CashflowItem[]; totals: CashTotal[] } {
  const items = (p.cashflows ?? [])
    .filter(r => r && r.date && r.kind && r.date >= from && r.date < to)
    .map((r, i) => ({
      id: r.id ?? `${r.date}-${i}`,
      date: r.date as string,
      kind: r.kind as CashKind,
      symbol: r.symbol ?? '',
      currency: (r.currency || 'EUR').toUpperCase(),
      amount: num(r.amount),
      description: r.description ?? '',
      ...(num(r.exchangeRate) > 0 ? { exchangeRate: num(r.exchangeRate) } : {}),
    }))
    .sort((a, b) => b.date.localeCompare(a.date))
  const sums = new Map<string, CashTotal>()
  for (const it of items) {
    const k = `${it.kind}|${it.currency}`
    const t = sums.get(k) ?? { kind: it.kind, currency: it.currency, amount: 0 }
    t.amount += it.amount
    sums.set(k, t)
  }
  return { items, totals: [...sums.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.currency.localeCompare(b.currency)) }
}

export interface CashEurSummary {
  /** Totale in euro per tipo (dividendi, ritenute, interessi…). */
  byKind: { kind: CashKind; eur: number }[]
  /** Saldo netto in euro di tutti i movimenti di cassa del periodo. */
  netEur: number
  /** Movimenti senza cambio (né salvato né di oggi): esclusi dai totali. */
  missing: number
}

/**
 * Totali in euro dei movimenti di cassa: al cambio del giorno salvato dalla sincronizzazione IBKR,
 * altrimenti a quello di oggi (`latestFx`, unità di valuta per 1 EUR).
 */
export function cashTotalsEur(items: CashflowItem[], latestFx: Record<string, number>): CashEurSummary {
  const sums = new Map<CashKind, number>()
  let missing = 0
  for (const it of items) {
    const rate = it.currency === 'EUR' ? 1 : it.exchangeRate && it.exchangeRate > 0 ? it.exchangeRate : latestFx[it.currency]
    if (!rate || rate <= 0) {
      missing++
      continue
    }
    sums.set(it.kind, (sums.get(it.kind) ?? 0) + it.amount / rate)
  }
  const byKind = [...sums].map(([kind, eur]) => ({ kind, eur })).sort((a, b) => a.kind.localeCompare(b.kind))
  return { byKind, netEur: byKind.reduce((s, k) => s + k.eur, 0), missing }
}
