import { useCallback, useEffect, useMemo, useState } from 'react'
import { computeAllPortfolios, type PortfolioResult, type RawPortfolio } from '../domain/engine/portfolio.ts'
import type { FxLookup } from '../domain/engine/types.ts'
import { totals, valuePositions, type PortfolioTotals, type PositionRow, type QuoteLike, symbolOf } from '../domain/engine/valuation.ts'
import { loadFx, withRecentFallback } from '../lib/fxRates.ts'
import { cachedQuotes, loadLatestFx, loadQuotes } from '../lib/prices.ts'
import { useSelectedPortfolioId } from './selection.ts'
import { usePortfolioState } from './usePortfolioState.ts'

/** Simbolo Yahoo del cambio: prezzo = dollari per 1 euro. */
export const EURUSD_SYMBOL = 'EURUSD=X'

export interface LiveFx {
  /** Dollari per 1 euro. */
  rate: number
  changePct: number | null
}

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
      /** Cambio EUR/USD in tempo reale (o quello del giorno se Yahoo non risponde). */
      eurUsd: LiveFx | null
      /** Quando sono stati scaricati i prezzi mostrati (ms), e il pulsante Aggiorna. */
      pricesAt: number | null
      refreshPrices: () => void
      /** Tutti i portafogli e i loro risultati: servono per il peso su "Tutti". */
      portfolios: Record<string, RawPortfolio>
      allResults: Record<string, PortfolioResult>
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
  const [latestFx, setLatestFx] = useState<Record<string, number>>({})
  useEffect(() => {
    if (!portfolio) return
    let alive = true
    loadFx(fxDates(Object.values(portfolios)))
      .then(hist => {
        if (!alive) return
        const fx = withRecentFallback(hist, latestFx, new Date().toISOString().slice(0, 10))
        setResults(computeAllPortfolios(portfolios, fx))
        setFx(() => fx)
        setFxError(null)
      })
      .catch(e => alive && setFxError(String(e)))
    return () => {
      alive = false
    }
  }, [portfolio, portfolios, latestFx])

  const result = selectedId && results ? results[selectedId] ?? null : null

  // 2. Prezzi: subito quelli in cache, poi aggiornati.
  // Con i titoli si carica anche il cambio EUR/USD in tempo reale (Yahoo), mostrato nella barra prezzi.
  const symbols = useMemo(
    () => [...Object.entries(portfolio?.assets ?? {}).map(([id, a]) => symbolOf(a, id)), EURUSD_SYMBOL],
    [portfolio],
  )
  const [quotes, setQuotes] = useState<Record<string, QuoteLike & { at?: number }>>(() => cachedQuotes())
  const [loadedFor, setLoadedFor] = useState<string[] | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const pricesLoading = loadedFor !== symbols || refreshing
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
  const refreshPrices = useCallback(() => {
    setRefreshing(true)
    Promise.all([loadQuotes(symbols, true), loadLatestFx()])
      .then(([q, fx]) => {
        setQuotes(prev => ({ ...prev, ...q }))
        if (Object.keys(fx).length) setLatestFx(fx)
      })
      .finally(() => setRefreshing(false))
  }, [symbols])
  // Ora dell'ultimo scaricamento dei prezzi (il più vecchio tra i titoli del portafoglio).
  const pricesAt = useMemo(() => {
    const ats = symbols.map(s => quotes[s]?.at).filter((x): x is number => typeof x === 'number')
    return ats.length ? Math.min(...ats) : null
  }, [symbols, quotes])
  const fxQuote = quotes[EURUSD_SYMBOL]
  const eurUsd: LiveFx | null = fxQuote
    ? { rate: fxQuote.price, changePct: fxQuote.previousClose ? ((fxQuote.price - fxQuote.previousClose) / fxQuote.previousClose) * 100 : null }
    : latestFx.USD
      ? { rate: latestFx.USD, changePct: null }
      : null

  const rows = useMemo(
    () => (result && portfolio ? valuePositions(portfolio.assets ?? {}, result.positions, quotes, latestFx) : []),
    [result, portfolio, quotes, latestFx],
  )

  if (state.status === 'loading') return { status: 'loading' }
  if (state.status === 'error') return { status: 'error', message: state.message }
  if (fxError) return { status: 'error', message: `Cambi storici non disponibili: ${fxError}` }
  if (!portfolio || !selectedId) return { status: 'empty' }
  if (!result || !fx) return { status: 'loading' }
  return {
    status: 'ready', options, selectedId, select, portfolio, result, rows, totals: totals(rows), pricesLoading, fx, latestFx,
    eurUsd, pricesAt, refreshPrices, portfolios, allResults: results!,
  }
}
