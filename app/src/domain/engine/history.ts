// Storico del valore di un portafoglio e rendimento confrontabile con gli indici. Funzioni pure, senza rete.
//
// - Valore di ogni giorno di borsa = quantità possedute × ultima chiusura nota, in euro al cambio del giorno
//   (gli short valgono in negativo). Prima della prima chiusura si usa il prezzo del movimento.
// - Capitale investito = somma di acquisti − vendite (e trasferimenti in entrata/uscita al valore di mercato).
// - Rendimento "time-weighted": ogni giorno (valore − soldi entrati quel giorno) / valore del giorno prima;
//   così versare o ritirare soldi non conta come guadagno o perdita, ed è confrontabile con un indice.
// Serve per i grafici, non per il fisco: cambi di mercato (Yahoo), non della Banca d'Italia.

import { num } from './fx.ts'
import type { RawAsset } from './types.ts'

export type Closes = Record<string, number> // data → chiusura

export interface HistoryInput {
  /** Titoli del portafoglio con il simbolo Yahoo usato per le chiusure. */
  assets: { symbol: string; currency: string; transactions: RawAsset['transactions'] }[]
  closes: Record<string, Closes>
  /** Cambio di mercato per valuta: unità di valuta per 1 EUR, per data. */
  fx: Record<string, Closes>
  /** Ultimo giorno (incluso), di solito oggi. */
  to: string
}

export interface HistoryPoint {
  date: string
  valueEur: number
  investedEur: number
  /** Rendimento cumulato dal primo giorno, in % (time-weighted). */
  twrPct: number
}

export interface History {
  points: HistoryPoint[]
  /** Simboli senza chiusure: valutati al prezzo dei movimenti. */
  missing: string[]
}

export function buildHistory(input: HistoryInput): History {
  const txs = input.assets.flatMap((a, ai) => (a.transactions ?? []).filter(t => t?.date && t.date <= input.to).map(t => ({ ai, t })))
  if (!txs.length) return { points: [], missing: [] }
  txs.sort((x, y) => x.t.date.localeCompare(y.t.date))
  const first = txs[0]!.t.date

  // Giorni di borsa: tutti quelli con almeno una chiusura, dal primo movimento.
  const days = new Set<string>()
  for (const s of Object.values(input.closes)) for (const d of Object.keys(s)) if (d >= first && d <= input.to) days.add(d)
  for (const { t } of txs) days.add(t.date)
  const dates = [...days].sort()

  const qty = input.assets.map(() => 0)
  const lastPrice = input.assets.map(() => NaN)
  const lastFx = new Map<string, number>()
  const missing = input.assets.filter(a => !input.closes[a.symbol] || !Object.keys(input.closes[a.symbol]!).length).map(a => a.symbol)

  const rateOn = (cur: string, d: string) => {
    if (cur === 'EUR') return 1
    const r = input.fx[cur]?.[d]
    if (r && r > 0) lastFx.set(cur, r)
    return lastFx.get(cur)
  }

  const points: HistoryPoint[] = []
  let k = 0
  let invested = 0
  let prevValue = 0
  let growth = 1
  for (const d of dates) {
    // Prezzi e cambi del giorno (se il titolo non ha quotato si tiene l'ultima chiusura).
    input.assets.forEach((a, i) => {
      const c = input.closes[a.symbol]?.[d]
      if (c && c > 0) lastPrice[i] = c
    })
    let flow = 0
    while (k < txs.length && txs[k]!.t.date === d) {
      const { ai, t } = txs[k++]!
      const a = input.assets[ai]!
      const q = num(t.qty)
      const p = num(t.price)
      if (Number.isNaN(lastPrice[ai]!)) lastPrice[ai] = p
      const rate = rateOn(a.currency, d) ?? NaN
      const market = (q * (input.closes[a.symbol]?.[d] ?? (lastPrice[ai]! || p))) / rate
      switch (t.type) {
        case 'buy':
          qty[ai]! += q
          flow += (q * p) / rate
          break
        case 'sell':
          qty[ai]! -= q
          flow -= (q * p) / rate
          break
        case 'short_sell':
          qty[ai]! -= q
          flow -= (q * p) / rate
          break
        case 'buy_to_cover':
          qty[ai]! += q
          flow += (q * p) / rate
          break
        case 'transfer':
          if (t.sourcePortfolioId) {
            qty[ai]! += q
            flow += market
          } else {
            qty[ai]! -= q
            flow -= market
          }
          break
      }
    }
    let value = 0
    let ok = true
    input.assets.forEach((a, i) => {
      if (Math.abs(qty[i]!) < 1e-9) return
      const rate = rateOn(a.currency, d)
      if (!rate || Number.isNaN(lastPrice[i]!)) {
        ok = false
        return
      }
      value += (qty[i]! * lastPrice[i]!) / rate
    })
    if (!ok || !Number.isFinite(value) || !Number.isFinite(flow)) continue
    invested += flow
    // Guadagno del giorno sul valore del giorno prima (in valore assoluto: vale anche se si è short).
    if (Math.abs(prevValue) > 1e-6) growth *= 1 + (value - flow - prevValue) / Math.abs(prevValue)
    prevValue = value
    points.push({ date: d, valueEur: value, investedEur: invested, twrPct: (growth - 1) * 100 })
  }
  return { points, missing }
}

/** Serie di un indice in euro (opzionale: `fx` = USD per 1 EUR per data), in % dal primo giorno del periodo. */
export function indexReturn(closes: Closes, from: string, to: string, fx?: Closes): { date: string; pct: number }[] {
  const dates = Object.keys(closes).filter(d => d >= from && d <= to).sort()
  let lastFx: number | undefined
  let base: number | undefined
  const out: { date: string; pct: number }[] = []
  for (const d of dates) {
    if (fx?.[d]) lastFx = fx[d]
    const v = fx ? (lastFx ? closes[d]! / lastFx : undefined) : closes[d]!
    if (v == null) continue
    base ??= v
    out.push({ date: d, pct: (v / base - 1) * 100 })
  }
  return out
}

/** Rendimento del portafoglio ribasato al primo giorno del periodo. */
export function rebase(points: HistoryPoint[], from: string): { date: string; pct: number }[] {
  const inRange = points.filter(p => p.date >= from)
  if (!inRange.length) return []
  const base = 1 + inRange[0]!.twrPct / 100
  return inRange.map(p => ({ date: p.date, pct: ((1 + p.twrPct / 100) / base - 1) * 100 }))
}
