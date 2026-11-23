import { useEffect, useState } from 'react'
import { dividendsFromCashflows, estimateDividends, qtyBefore, type CashflowLike, type DividendRow } from '../domain/engine/dividends.ts'
import type { RawPortfolio } from '../domain/engine/portfolio.ts'
import type { FxLookup } from '../domain/engine/types.ts'
import { symbolOf } from '../domain/engine/valuation.ts'
import { loadDividends } from '../lib/dividends.ts'
import { loadFx } from '../lib/fxRates.ts'
import { localToday } from '../lib/today'

export interface DividendsState {
  status: 'loading' | 'ready'
  rows: DividendRow[]
  /** 'ibkr' = movimenti di cassa veri del conto; 'stima' = calcolati da Yahoo. */
  source: 'ibkr' | 'stima'
}

/** Dividendi del portafoglio: veri se il conto ha i movimenti di cassa (IBKR), altrimenti stimati da Yahoo. */
export function useDividends(portfolio: RawPortfolio, fx: FxLookup): DividendsState {
  const flows = (portfolio as { cashflows?: CashflowLike[] }).cashflows
  const hasFlows = Array.isArray(flows) && flows.length > 0
  const regime = portfolio.taxRegime === 'dichiarativo' ? 'dichiarativo' : 'amministrato'
  const [estimate, setEstimate] = useState<{ for: RawPortfolio; rows: DividendRow[] } | null>(null)

  useEffect(() => {
    if (hasFlows) return
    let alive = true
    const today = localToday()
    const assets = Object.entries(portfolio.assets ?? {})
    loadDividends(assets.map(([id, a]) => symbolOf(a, id)))
      .then(async byTicker => {
        const dates = new Set<string>()
        for (const [id, a] of assets) {
          for (const d of byTicker[symbolOf(a, id)] ?? []) if (d.exDate < today && qtyBefore(a.transactions ?? [], d.exDate) > 0) dates.add(d.exDate)
        }
        const lookup = await loadFx(dates)
        const rows = assets.flatMap(([id, a]) => estimateDividends(id, a, byTicker[symbolOf(a, id)] ?? [], regime, lookup, today))
        if (alive) setEstimate({ for: portfolio, rows })
      })
      .catch(() => alive && setEstimate({ for: portfolio, rows: [] }))
    return () => {
      alive = false
    }
  }, [portfolio, hasFlows, regime])

  if (hasFlows) return { status: 'ready', rows: dividendsFromCashflows(flows, regime, fx), source: 'ibkr' }
  if (estimate?.for === portfolio) return { status: 'ready', rows: estimate.rows, source: 'stima' }
  return { status: 'loading', rows: [], source: 'stima' }
}
