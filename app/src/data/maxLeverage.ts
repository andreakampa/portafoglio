import { useCallback, useSyncExternalStore } from 'react'

// Soglia di leva massima scelta da Andrea, ricordata su questo dispositivo (come il portafoglio scelto).
const KEY = 'ptpro_v2_max_leverage'
const listeners = new Set<() => void>()

function read(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

export function parseLeverage(text: string | null): number | null {
  const v = parseFloat((text ?? '').replace(',', '.'))
  return Number.isFinite(v) && v >= 1 ? v : null
}

export function useMaxLeverage(): [number | null, (v: number | null) => void] {
  const raw = useSyncExternalStore(
    cb => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    read,
  )
  const set = useCallback((v: number | null) => {
    try {
      if (v === null) localStorage.removeItem(KEY)
      else localStorage.setItem(KEY, String(v))
    } catch {
      /* non salvata: vale solo per questa sessione */
    }
    listeners.forEach(l => l())
  }, [])
  return [parseLeverage(raw), set]
}
