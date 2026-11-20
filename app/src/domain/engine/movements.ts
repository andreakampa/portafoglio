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
