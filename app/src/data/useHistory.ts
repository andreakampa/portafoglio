import { useEffect, useMemo, useState } from 'react'
import { buildHistory, type Closes, type History } from '../domain/engine/history.ts'
import { marginDebtByDate, type MarginPortfolio } from '../domain/engine/margin.ts'
import type { MarginDayRow } from '../domain/ibkr/sync.ts'
import type { RawPortfolio } from '../domain/engine/portfolio.ts'
import { symbolOf } from '../domain/engine/valuation.ts'
import { loadCloses } from '../lib/priceHistory.ts'
import { mapLimit } from '../lib/proxy.ts'
import { localToday } from '../lib/today'

/** Indici di confronto (simbolo Yahoo, nome, valuta). */
export const BENCHMARKS = [
  { symbol: '^GSPC', name: 'S&P 500', currency: 'USD' },
  { symbol: '^NDX', name: 'Nasdaq 100', currency: 'USD' },
] as const

const TODAY = localToday()

// Le chiusure storiche cambiano solo una volta al giorno: cache in memoria per la sessione.
const memory = new Map<string, Promise<Closes>>()
function closesOf(symbol: string, range: '2y' | '5y' | '10y'): Promise<Closes> {
  const key = `${symbol}|${range}`
  let p = memory.get(key)
  if (!p) {
    p = loadCloses(symbol, range).catch(() => {
      memory.delete(key)
      return {}
    })
    memory.set(key, p)
  }
  return p
}

export interface HistoryState {
  status: 'loading' | 'ready'
  history: History | null
  /** Chiusure degli indici e cambio USD per 1 EUR (per riportarli in euro). */
  benchmarks: Record<string, Closes>
  eurUsd: Closes
  /** Debito sul margine in euro per ogni giorno dello storico; null se il portafoglio non ha dati sul margine. */
  debt: Map<string, number> | null
}

/** Storico del valore del portafoglio scelto e degli indici di confronto (Yahoo, via Worker). */
export function useHistory(portfolio: RawPortfolio | undefined): HistoryState {
  const [state, setState] = useState<{ for: RawPortfolio; value: HistoryState } | null>(null)
  const today = TODAY

  const assets = useMemo(
    () =>
      Object.entries(portfolio?.assets ?? {})
        .filter(([, a]) => (a.transactions ?? []).length)
        .map(([id, a]) => ({ symbol: symbolOf(a, id), currency: (a.valuta || 'EUR').toUpperCase(), transactions: a.transactions })),
    [portfolio],
  )

  useEffect(() => {
    if (!portfolio) return
    let alive = true
    const first = assets.flatMap(a => (a.transactions ?? []).map(t => t.date)).filter(Boolean).sort()[0] ?? today
    const years = (Date.parse(today) - Date.parse(first)) / (365 * 86400000)
    const range = years > 4.5 ? '10y' : years > 1.8 ? '5y' : '2y'
    const mp = portfolio as MarginPortfolio
    const marginRows: Partial<MarginDayRow>[] = Array.isArray(mp.marginDaily) ? mp.marginDaily : Object.values((mp.marginDaily ?? {}) as Record<string, MarginDayRow>)
    const marginCurrencies = marginRows.map(r => (r?.currency || 'EUR').toUpperCase())
    const currencies = [...new Set(assets.map(a => a.currency).concat(marginCurrencies).filter(c => c !== 'EUR').concat('USD'))]
    ;(async () => {
      const closes: Record<string, Closes> = {}
      await mapLimit([...new Set(assets.map(a => a.symbol))], 5, async s => void (closes[s] = await closesOf(s, range)))
      const fx: Record<string, Closes> = {}
      await mapLimit(currencies, 4, async c => void (fx[c] = await closesOf(`EUR${c}=X`, range)))
      const benchmarks: Record<string, Closes> = {}
      await mapLimit([...BENCHMARKS], 2, async b => void (benchmarks[b.symbol] = await closesOf(b.symbol, range)))
      const history = buildHistory({ assets, closes, fx, to: today })
      const debt = marginDebtByDate(mp, history.points.map(p => p.date), fx)
      if (alive) setState({ for: portfolio, value: { status: 'ready', history, benchmarks, eurUsd: fx.USD ?? {}, debt } })
    })()
    return () => {
      alive = false
    }
  }, [portfolio, assets, today])

  if (state && state.for === portfolio) return state.value
  return { status: 'loading', history: state?.value.history ?? null, benchmarks: state?.value.benchmarks ?? {}, eurUsd: state?.value.eurUsd ?? {}, debt: state?.value.debt ?? null }
}
