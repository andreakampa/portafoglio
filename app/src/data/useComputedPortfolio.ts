import { useEffect, useMemo, useState } from 'react'
import { computeAllPortfolios, type PortfolioResult, type RawPortfolio } from '../domain/engine/portfolio.ts'
import type { FxLookup } from '../domain/engine/types.ts'
import { totals, valuePositions, type PortfolioTotals, type PositionRow, type QuoteLike, symbolOf } from '../domain/engine/valuation.ts'
import { loadFx } from '../lib/fxRates.ts'
import { cachedQuotes, loadLatestFx, loadQuotes } from '../lib/prices.ts'
import { useSelectedPortfolioId } from './selection.ts'
import { usePortfolioState } from './usePortfolioState.ts'

export interface PortfolioOption {
  id: string
  name: string
  regime: string
}

export type Computed =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'empty' }
  | {
      status: 'ready'
      options: PortfolioOption[]
      selectedId: string
      select: (id: string) => void
      portfolio: RawPortfolio
      result: PortfolioResult
      rows: PositionRow[]
      totals: PortfolioTotals
      pricesLoading: boolean
      /** Cambi storici e più recenti: servono al simulatore. */
      fx: FxLookup
      latestFx: Record<string, number>
    }

/** Date (e valute) per cui servono i cambi storici: movimenti di titoli non in EUR o commissioni in valuta. */
function fxDates(ps: RawPortfolio[]): string[] {
  const dates: string[] = []
  for (const a of ps.flatMap(p => Object.values(p.assets ?? {}))) {
    const nonEur = (a.valuta || 'EUR').toUpperCase() !== 'EUR'
    for (const t of a.transactions ?? []) {
      if (nonEur || (t.commissionCurrency && t.commissionCurrency.toUpperCase() !== 'EUR')) dates.push(t.date)
    }
  }
  return dates
}

/** Portafoglio scelto, calcolato con il nuovo motore e valorizzato ai prezzi attuali. */
export function useComputedPortfolio(): Computed {
  const state = usePortfolioState()
  const [storedId, select] = useSelectedPortfolioId()

  const portfolios = state.status === 'ready' ? (state.data?.portfolios as Record<string, RawPortfolio> | undefined) ?? {} : {}
  const options: PortfolioOption[] = Object.entries(portfolios).map(([id, p]) => ({
    id,
    name: p.name?.trim() || 'Portafoglio senza nome',
    regime: p.taxRegime === 'dichiarativo' ? 'dichiarativo' : 'amministrato',
  }))
  const fallbackId = state.status === 'ready' ? state.data?.activePortfolioId : undefined
  const selectedId = storedId && portfolios[storedId] ? storedId : fallbackId && portfolios[fallbackId] ? fallbackId : options[0]?.id
  const portfolio = selectedId ? portfolios[selectedId] : undefined

  // 1. Cambi storici → motore (si ricalcola a ogni modifica dei dati, anche da un altro dispositivo).
  // Tutti i portafogli insieme: un titolo trasferito porta con sé il costo dell'acquisto originale.
  const [results, setResults] = useState<Record<string, PortfolioResult> | null>(null)
  const [fx, setFx] = useState<FxLookup | null>(null)
  const [fxError, setFxError] = useState<string | null>(null)
  useEffect(() => {
    if (!portfolio) return
    let alive = true
    loadFx(fxDates(Object.values(portfolios)))
      .then(fx => alive && (setResults(computeAllPortfolios(portfolios, fx)), setFx(() => fx), setFxError(null)))
      .catch(e => alive && setFxError(String(e)))
    return () => {
      alive = false
    }
  }, [portfolio, portfolios])

  const result = selectedId && results ? results[selectedId] ?? null : null

  // 2. Prezzi: subito quelli in cache, poi aggiornati.
  const symbols = useMemo(
    () => Object.entries(portfolio?.assets ?? {}).map(([id, a]) => symbolOf(a, id)),
    [portfolio],
  )
  const [quotes, setQuotes] = useState<Record<string, QuoteLike>>(() => cachedQuotes())
  const [latestFx, setLatestFx] = useState<Record<string, number>>({})
  const [loadedFor, setLoadedFor] = useState<string[] | null>(null)
  const pricesLoading = loadedFor !== symbols
  useEffect(() => {
    let alive = true
    Promise.all([loadQuotes(symbols), loadLatestFx()]).then(([q, fx]) => {
      if (!alive) return
      setQuotes(prev => ({ ...prev, ...q }))
      if (Object.keys(fx).length) setLatestFx(fx)
      setLoadedFor(symbols)
    })
    const timer = setInterval(() => loadQuotes(symbols).then(q => alive && setQuotes(prev => ({ ...prev, ...q }))), 5 * 60 * 1000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [symbols])

  const rows = useMemo(
    () => (result && portfolio ? valuePositions(portfolio.assets ?? {}, result.positions, quotes, latestFx) : []),
    [result, portfolio, quotes, latestFx],
  )

  if (state.status === 'loading') return { status: 'loading' }
  if (state.status === 'error') return { status: 'error', message: state.message }
  if (fxError) return { status: 'error', message: `Cambi storici non disponibili: ${fxError}` }
  if (!portfolio || !selectedId) return { status: 'empty' }
  if (!result || !fx) return { status: 'loading' }
  return { status: 'ready', options, selectedId, select, portfolio, result, rows, totals: totals(rows), pricesLoading, fx, latestFx }
}
