import { onValue, ref, remove, set } from 'firebase/database'
import { useCallback, useEffect, useState } from 'react'
import { useUser } from '../auth/context'
import { parseMaintPct } from '../domain/engine/marginStress'
import { db } from '../lib/firebase'

/**
 * Margine di mantenimento IBKR in % scelto dall'utente per lo stress test (il report Flex non lo contiene).
 * Salvato su Firebase, quindi uguale su telefono e PC. null = si usa la stima standard.
 */
export function useMaintMarginPct(): [number | null, (v: number | null) => Promise<void>] {
  const { user } = useUser()
  const path = `users/${user.uid}/settings/maintMarginPct`
  const [pct, setPct] = useState<number | null>(null)

  useEffect(
    () =>
      onValue(
        ref(db, path),
        snap => setPct(parseMaintPct(snap.exists() ? String(snap.val()) : null)),
        () => setPct(null),
      ),
    [path],
  )

  const save = useCallback((v: number | null) => (v === null ? remove(ref(db, path)) : set(ref(db, path), v)), [path])
  return [pct, save]
}
