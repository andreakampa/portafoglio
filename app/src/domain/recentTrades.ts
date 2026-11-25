// Operazioni recenti (Panoramica): acquisti e aperture di short degli ultimi giorni, quanto sono costati e quanto valgono adesso.
// Funzione pura. Pensata per il trading di breve: non è il costo fiscale (quello resta nel motore).
import { amounts } from './engine/fx.ts'
import type { RawPortfolio } from './engine/portfolio.ts'
import type { FxLookup, RawTx } from './engine/types.ts'
import { symbolOf } from './engine/valuation.ts'

export const RECENT_WINDOWS = ['1', '3', '7'] as const
export type RecentWindow = (typeof RECENT_WINDOWS)[number]
/** Oltre una settimana non si guarda (scelta di Andrea). */
export const MAX_DAYS = 7

export interface RecentTrade {
  key: string
  assetId: string
  symbol: string
  date: string
  kind: 'buy' | 'short_sell'
  qty: number
  /** Prezzo di esecuzione, nella valuta del titolo. */
  price: number
  currency: string
  /** Pagato (acquisto) o incassato (short), commissioni comprese, in euro al cambio del giorno dell'operazione. */
  costEur: number
  /** Quantità ancora aperta e la sua parte di costo. */
  openQty: number
  openCostEur: number
  /** Valore adesso della parte aperta (prezzo e cambio di oggi); null senza prezzo. */
  priceNow: number | null
  valueEur: number | null
  /** Positivo = guadagno, anche per gli short. Solo la parte aperta. */
  unrealizedEur: number | null
  unrealizedPct: number | null
  /** Parte già chiusa dopo l'operazione (venduta o ricoperta), con il risultato incassato. */
  closedQty: number
  closedOn: string | null
  realizedEur: number | null
}

export interface RecentTotals {
  count: number
  costEur: number
  unrealizedEur: number
  unrealizedPct: number | null
  /** Operazioni aperte senza prezzo: escluse dal totale. */
  missingPrices: number
}

/** Prima data compresa nel periodo: oggi meno N giorni di calendario (di lunedì, 3 giorni arrivano al venerdì). */
export function windowStart(today: string, days: number): string {
  const d = new Date(today + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

interface Open {
  trade: RecentTrade
  left: number
}

/**
 * Operazioni degli ultimi 7 giorni, dalla più recente.
 * Le vendite (o ricoperture) successive chiudono prima l'operazione più recente dello stesso titolo:
 * la parte chiusa mostra il risultato incassato e non entra nel non realizzato.
 */
export function recentTrades(
  p: RawPortfolio,
  fx: FxLookup,
  quotes: Record<string, { price: number; currency?: string } | undefined>,
  latestFx: Record<string, number>,
  today: string,
): RecentTrade[] {
  const from = windowStart(today, MAX_DAYS)
  // Cambio del giorno; se non ancora pubblicato, quello di oggi (basta per un conto di breve).
  const fxOr: FxLookup = (c, d) => fx(c, d) ?? latestFx[c.toUpperCase()]
  const out: RecentTrade[] = []
  for (const [assetId, a] of Object.entries(p.assets ?? {})) {
    const assetCur = (a.valuta || 'EUR').toUpperCase()
    const symbol = symbolOf(a, assetId)
    const q = quotes[symbol]
    const cur = (q?.currency || assetCur).toUpperCase()
    const rateNow = cur === 'EUR' ? 1 : latestFx[cur]
    const txs = (a.transactions ?? [])
      .map((t, i) => ({ t, i }))
      .filter(({ t }) => t.date && t.date >= from && t.date <= today)
      .sort((x, y) => (x.t.date < y.t.date ? -1 : x.t.date > y.t.date ? 1 : x.i - y.i))
    const stacks: Record<'buy' | 'short_sell', Open[]> = { buy: [], short_sell: [] }
    for (const { t, i } of txs) {
      if (t.type === 'buy' || t.type === 'short_sell') {
        const am = amounts(t, assetCur, fxOr, [])
        if (!(am.qty > 0) || !Number.isFinite(am.grossEur)) continue
        const costEur = t.type === 'buy' ? am.grossEur + am.commissionEur : am.grossEur - am.commissionEur
        const trade: RecentTrade = {
          key: `${assetId}#${t.id ?? i}`, assetId, symbol, date: t.date, kind: t.type, qty: am.qty, price: am.price, currency: assetCur,
          costEur, openQty: am.qty, openCostEur: costEur, priceNow: null, valueEur: null, unrealizedEur: null, unrealizedPct: null,
          closedQty: 0, closedOn: null, realizedEur: null,
        }
        stacks[t.type].push({ trade, left: am.qty })
        out.push(trade)
      } else if (t.type === 'sell' || t.type === 'buy_to_cover') {
        close(stacks[t.type === 'sell' ? 'buy' : 'short_sell'], t, assetCur, fxOr)
      }
    }
    for (const tr of out.filter(x => x.assetId === assetId)) {
      tr.openCostEur = tr.costEur * (tr.openQty / tr.qty)
      if (tr.openQty > 1e-9 && q && rateNow) {
        const market = (tr.openQty * q.price) / rateNow
        tr.priceNow = q.price
        tr.valueEur = market
        tr.unrealizedEur = tr.kind === 'buy' ? market - tr.openCostEur : tr.openCostEur - market
        tr.unrealizedPct = tr.openCostEur > 0 ? (tr.unrealizedEur / tr.openCostEur) * 100 : null
      } else if (q) {
        tr.priceNow = q.price
      }
    }
  }
  return out.sort((x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : 0))
}

function close(stack: Open[], t: RawTx, assetCur: string, fx: FxLookup) {
  const am = amounts(t, assetCur, fx, [])
  if (!(am.qty > 0)) return
  // Ricavo (vendita) o spesa (ricopertura) per azione, commissioni comprese.
  const perShare = (t.type === 'sell' ? am.grossEur - am.commissionEur : am.grossEur + am.commissionEur) / am.qty
  let left = am.qty
  for (let k = stack.length - 1; k >= 0 && left > 1e-9; k--) {
    const o = stack[k]!
    if (o.left <= 1e-9) continue
    const used = Math.min(o.left, left)
    o.left -= used
    left -= used
    const tr = o.trade
    const costShare = tr.costEur * (used / tr.qty)
    const gain = tr.kind === 'buy' ? perShare * used - costShare : costShare - perShare * used
    tr.openQty = o.left
    tr.closedQty += used
    tr.closedOn = t.date
    tr.realizedEur = Number.isFinite(gain) ? (tr.realizedEur ?? 0) + gain : tr.realizedEur
  }
}

export const inWindow = (list: RecentTrade[], today: string, days: number) => {
  const from = windowStart(today, days)
  return list.filter(t => t.date >= from)
}

/** P&L non realizzato del periodo: solo la parte ancora aperta delle operazioni con un prezzo. */
export function recentTotals(list: RecentTrade[]): RecentTotals {
  let costEur = 0
  let unrealizedEur = 0
  let missingPrices = 0
  for (const t of list) {
    if (t.openQty <= 1e-9) continue
    if (t.unrealizedEur == null) {
      missingPrices++
      continue
    }
    costEur += t.openCostEur
    unrealizedEur += t.unrealizedEur
  }
  return { count: list.length, costEur, unrealizedEur, unrealizedPct: costEur > 0 ? (unrealizedEur / costEur) * 100 : null, missingPrices }
}
