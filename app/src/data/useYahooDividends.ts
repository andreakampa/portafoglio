import { useEffect, useState } from 'react'
import type { YahooDividend } from '../domain/engine/dividends'
import { loadDividends } from '../lib/dividends'

/** Dividendi Yahoo dei titoli (cache di 24 ore): servono per il pallino nella tabella Posizioni. */
export function useYahooDividends(symbols: string[]): Record<string, YahooDividend[]> {
  const key = [...new Set(symbols)].sort().join(',')
  const [divs, setDivs] = useState<Record<string, YahooDividend[]>>({})
  useEffect(() => {
    if (!key) return
    let alive = true
    void loadDividends(key.split(',')).then(d => alive && setDivs(d))
    return () => {
      alive = false
    }
  }, [key])
  return divs
}
