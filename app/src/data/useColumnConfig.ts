import { onValue, ref, set } from 'firebase/database'
import { useCallback, useEffect, useState } from 'react'
import { useUser } from '../auth/context'
import { reconcileColumns, type ColumnConfig } from '../domain/positionTable'
import { db } from '../lib/firebase'

/** Colonne della tabella Posizioni scelte da Andrea: salvate su Firebase, uguali su tutti i dispositivi. */
export function useColumnConfig(): [ColumnConfig, (c: ColumnConfig) => Promise<void>] {
  const { user } = useUser()
  const path = `users/${user.uid}/settings/positionColumns`
  const [cfg, setCfg] = useState<ColumnConfig>(() => reconcileColumns(null))
  useEffect(
    () =>
      onValue(
        ref(db, path),
        snap => setCfg(reconcileColumns(snap.exists() ? (snap.val() as Partial<ColumnConfig>) : null)),
        () => setCfg(reconcileColumns(null)),
      ),
    [path],
  )
  const save = useCallback(
    (c: ColumnConfig) => {
      setCfg(c)
      return set(ref(db, path), c)
    },
    [path],
  )
  return [cfg, save]
}
