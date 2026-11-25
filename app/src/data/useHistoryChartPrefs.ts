import { onValue, ref, set } from 'firebase/database'
import { useCallback, useEffect, useState } from 'react'
import { useUser } from '../auth/context'
import { DEFAULT_PREFS, reconcileChartPrefs, type HistoryChartPrefs } from '../domain/historyChart'
import { db } from '../lib/firebase'

/** Ultima scelta fatta sul grafico Andamento: salvata su Firebase, uguale su tutti i dispositivi. */
export function useHistoryChartPrefs(): [HistoryChartPrefs, (p: HistoryChartPrefs) => void] {
  const { user } = useUser()
  const path = `users/${user.uid}/settings/historyChart`
  const [prefs, setPrefs] = useState<HistoryChartPrefs>(DEFAULT_PREFS)
  useEffect(
    () =>
      onValue(
        ref(db, path),
        snap => setPrefs(reconcileChartPrefs(snap.exists() ? snap.val() : null)),
        () => setPrefs(DEFAULT_PREFS),
      ),
    [path],
  )
  const save = useCallback(
    (p: HistoryChartPrefs) => {
      setPrefs(p)
      // Se non si salva (offline o errore) la scelta vale comunque finché la pagina resta aperta.
      set(ref(db, path), p).catch(() => {})
    },
    [path],
  )
  return [prefs, save]
}
