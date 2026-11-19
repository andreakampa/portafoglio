import { useCallback, useSyncExternalStore } from 'react'

// Portafoglio scelto, condiviso tra le schermate e ricordato su questo dispositivo.
const KEY = 'ptpro_v2_selected_portfolio'
const listeners = new Set<() => void>()

function read(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

export function useSelectedPortfolioId(): [string | null, (id: string) => void] {
  const id = useSyncExternalStore(
    cb => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    read,
  )
  const set = useCallback((next: string) => {
    try {
      localStorage.setItem(KEY, next)
    } catch {
      /* non salvato: vale solo per questa sessione */
    }
    listeners.forEach(l => l())
  }, [])
  return [id, set]
}
