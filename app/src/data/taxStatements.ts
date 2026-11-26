import { onValue, ref, set } from '../lib/vault'
import { useEffect, useState } from 'react'
import { useUser } from '../auth/context'
import type { SavedStatement, StatementCheck } from '../domain/ibkr/statement'
import { db } from '../lib/firebase'

/** Rendiconto importato per un anno: riassunto (prezzi di fine periodo) ed esito del confronto. */
export type StoredStatement = SavedStatement & { check: StatementCheck }

// Fuori da portfolio_state: la sincronizzazione IBKR riscrive il portafoglio e non deve toccarlo.
const path = (uid: string, pid: string, year: number) => `users/${uid}/taxStatements/${pid}/${year}`

/** Rendiconto salvato per portafoglio e anno (in tempo reale, uguale su tutti i dispositivi). undefined = in caricamento. */
export function useStoredStatement(pid: string | undefined, year: number): StoredStatement | null | undefined {
  const { user } = useUser()
  const [value, setValue] = useState<{ key: string; v: StoredStatement | null } | null>(null)
  const key = `${pid}|${year}`
  useEffect(() => {
    if (!pid) return
    return onValue(
      ref(db, path(user.uid, pid, year)),
      snap => setValue({ key, v: (snap.val() as StoredStatement | null) ?? null }),
      () => setValue({ key, v: null }),
    )
  }, [user.uid, pid, year, key])
  return value?.key === key ? value.v : undefined
}

export function useSaveStatement() {
  const { user } = useUser()
  return (pid: string, year: number, s: StoredStatement) => set(ref(db, path(user.uid, pid, year)), JSON.parse(JSON.stringify(s)))
}
