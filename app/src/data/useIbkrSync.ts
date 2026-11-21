import { onValue, ref } from 'firebase/database'
import { useEffect, useState } from 'react'
import { useUser } from '../auth/context'
import { syncStatusFromDb, type SyncStatus } from '../domain/ibkrSync'
import { db } from '../lib/firebase'

/** Stato dell'ultima sincronizzazione IBKR in tempo reale. `undefined` = sto caricando, `null` = mai eseguita. */
export function useIbkrSync() {
  const { user } = useUser()
  const [status, setStatus] = useState<SyncStatus | null | undefined>(undefined)

  useEffect(
    () =>
      onValue(
        ref(db, `users/${user.uid}/ibkr_sync`),
        snap => setStatus(syncStatusFromDb(snap.val())),
        () => setStatus(null),
      ),
    [user.uid],
  )

  return status
}
