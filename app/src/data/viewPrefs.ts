import { useCallback, useSyncExternalStore } from 'react'

// Scelte di visualizzazione ricordate su questo dispositivo (valuta mostrata, base dei pesi…).
const PREFIX = 'ptpro_v2_view_'
const listeners = new Set<() => void>()

function read(key: string): string | null {
  try {
    return localStorage.getItem(PREFIX + key)
  } catch {
    return null
  }
}

export function useViewPref<T extends string>(key: string, allowed: readonly T[], fallback: T): [T, (v: T) => void] {
  const raw = useSyncExternalStore(
    cb => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => read(key),
  )
  const value = (allowed as readonly string[]).includes(raw ?? '') ? (raw as T) : fallback
  const set = useCallback(
    (v: T) => {
      try {
        localStorage.setItem(PREFIX + key, v)
      } catch {
        /* non salvato: vale finché la pagina resta aperta */
      }
      listeners.forEach(l => l())
    },
    [key],
  )
  return [value, set]
}
