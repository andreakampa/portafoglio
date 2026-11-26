import { onValue, ref, remove, set } from '../lib/vault'
import { useCallback, useEffect, useState } from 'react'
import { useUser } from '../auth/context'
import { db } from '../lib/firebase'

/** Soglia valida: un numero da 1 in su (1,00x = nessuna leva). */
export function parseLeverage(text: string | null): number | null {
  const v = parseFloat((text ?? '').replace(',', '.'))
  return Number.isFinite(v) && v >= 1 ? v : null
}

/** Soglia di leva massima scelta da Andrea: salvata su Firebase, quindi uguale su telefono e PC (anche in tempo reale). */
export function useMaxLeverage(): [number | null, (v: number | null) => Promise<void>] {
  const { user } = useUser()
  const path = `users/${user.uid}/settings/maxLeverage`
  const [max, setMaxState] = useState<number | null>(null)

  useEffect(
    () =>
      onValue(
        ref(db, path),
        snap => setMaxState(parseLeverage(snap.exists() ? String(snap.val()) : null)),
        () => setMaxState(null),
      ),
    [path],
  )

  const save = useCallback((v: number | null) => (v === null ? remove(ref(db, path)) : set(ref(db, path), v)), [path])
  return [max, save]
}
