import { onValue, ref, remove, update } from 'firebase/database'
import { useEffect, useMemo, useState } from 'react'
import { useUser } from '../auth/context'
import { watchId, type WatchItem } from '../domain/watchlist'
import { db } from '../lib/firebase'

/**
 * Watchlist dell'utente (users/{uid}/settings/watchlist/{id}), uguale su tutti i dispositivi.
 * Le soglie sono lette anche dal Worker che ogni 15 minuti controlla i prezzi e manda le notifiche.
 */
export function useWatchlist() {
  const { user } = useUser()
  const base = `users/${user.uid}/settings/watchlist`
  const [items, setItems] = useState<WatchItem[] | null>(null)

  useEffect(
    () =>
      onValue(
        ref(db, base),
        snap => {
          const raw = (snap.val() ?? {}) as Record<string, Omit<WatchItem, 'id'>>
          setItems(Object.entries(raw).map(([id, it]) => ({ ...it, id })).sort((a, b) => a.symbol.localeCompare(b.symbol)))
        },
        () => setItems([]),
      ),
    [base],
  )

  const actions = useMemo(() => {
    const clean = (o: object) => JSON.parse(JSON.stringify(o)) as object
    return {
      /** Aggiunge titoli (quelli già presenti restano come sono). Torna quanti ne ha aggiunti. */
      add: async (list: { symbol: string; name?: string }[], existing: WatchItem[]) => {
        const have = new Set(existing.map(i => i.symbol.toUpperCase()))
        const now = new Date().toISOString()
        const fresh = list.filter(x => x.symbol && !have.has(x.symbol.toUpperCase()))
        if (!fresh.length) return 0
        await update(ref(db, base), Object.fromEntries(fresh.map(x => [watchId(x.symbol), clean({ symbol: x.symbol.toUpperCase(), name: x.name, addedAt: now })])))
        return fresh.length
      },
      /** Cambia soglie o nota; cambiando una soglia l'avviso si riarma. */
      save: (id: string, patch: Partial<Pick<WatchItem, 'above' | 'below' | 'note' | 'name'>>) =>
        update(ref(db, `${base}/${id}`), {
          above: patch.above ?? null,
          below: patch.below ?? null,
          note: patch.note?.trim() || null,
          ...(patch.name !== undefined ? { name: patch.name || null } : {}),
          fired: null,
        }),
      remove: (id: string) => remove(ref(db, `${base}/${id}`)),
    }
  }, [base])

  return { items, ...actions }
}
