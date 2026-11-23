import { useEffect, useMemo, useState } from 'react'
import { allPortfoliosGrossEur, allSymbols } from '../domain/display.ts'
import type { PortfolioResult, RawPortfolio } from '../domain/engine/portfolio.ts'
import { loadQuotes, type Quote } from '../lib/prices.ts'

/** Valore lordo di tutti i portafogli (base del peso "Tutti"). Carica i prezzi solo se serve. */
export function useAllPortfoliosValue(
  enabled: boolean,
  portfolios: Record<string, RawPortfolio>,
  results: Record<string, PortfolioResult>,
  latestFx: Record<string, number>,
): number | null {
  const symbols = useMemo(() => allSymbols(portfolios), [portfolios])
  const [quotes, setQuotes] = useState<Record<string, Quote> | null>(null)
  useEffect(() => {
    if (!enabled) return
    let alive = true
    void loadQuotes(symbols).then(q => alive && setQuotes(q))
    return () => {
      alive = false
    }
  }, [enabled, symbols])
  return useMemo(
    () => (enabled && quotes ? allPortfoliosGrossEur(portfolios, results, quotes, latestFx) : null),
    [enabled, quotes, portfolios, results, latestFx],
  )
}
