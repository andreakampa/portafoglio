import { onValue, ref, remove, set } from 'firebase/database'
import { useCallback, useEffect, useState } from 'react'
import { useUser } from '../auth/context'
import { db } from '../lib/firebase'

/**
 * Netti dei dividendi davvero accreditati, scritti a mano (per data di stacco).
 * Su Firebase in settings, fuori dal portafoglio, così la sincronizzazione IBKR non li tocca.
 */
export function useDividendActuals(pid: string, assetId: string): [Record<string, number>, (exDate: string, v: number | null) => Promise<void>] {
  const { user } = useUser()
  const path = `users/${user.uid}/settings/dividendActuals/${pid}/${assetId}`
  const [map, setMap] = useState<Record<string, number>>({})
  useEffect(
    () =>
      onValue(
        ref(db, path),
        snap => {
          const v = (snap.val() ?? {}) as Record<string, unknown>
          setMap(Object.fromEntries(Object.entries(v).filter(([, x]) => typeof x === 'number')) as Record<string, number>)
        },
        () => setMap({}),
      ),
    [path],
  )
  const save = useCallback(
    (exDate: string, v: number | null) => (v === null ? remove(ref(db, `${path}/${exDate}`)) : set(ref(db, `${path}/${exDate}`), v)),
    [path],
  )
  return [map, save]
}
