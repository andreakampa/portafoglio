import { onValue, ref, set } from '../lib/vault'
import { useCallback, useEffect, useState } from 'react'
import { useUser } from '../auth/context'
import { db } from '../lib/firebase'

/** Ordine dei filtri della watchlist scelto trascinandoli: salvato su Firebase, uguale su tutti i dispositivi. */
export function useWatchFilterOrder(): [string[] | null, (keys: string[]) => Promise<void>] {
  const { user } = useUser()
  const path = `users/${user.uid}/settings/watchFilterOrder`
  const [order, setOrder] = useState<string[] | null>(null)
  useEffect(
    () =>
      onValue(
        ref(db, path),
        snap => {
          const v = snap.val() as unknown
          setOrder(Array.isArray(v) ? v.filter((k): k is string => typeof k === 'string') : null)
        },
        () => setOrder(null),
      ),
    [path],
  )
  const save = useCallback(
    (keys: string[]) => {
      setOrder(keys)
      return set(ref(db, path), keys)
    },
    [path],
  )
  return [order, save]
}
