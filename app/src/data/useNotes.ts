import { onValue, push, ref, remove, update } from '../lib/vault'
import { useCallback, useEffect, useState } from 'react'
import { useUser } from '../auth/context'
import { notesFromDb, type Note } from '../domain/notes'
import { db } from '../lib/firebase'

export type NoteDraft = Omit<Note, 'id' | 'createdAt' | 'updatedAt'>

/** Note in tempo reale (anche da altri dispositivi) e operazioni per modificarle. */
export function useNotes() {
  const { user } = useUser()
  const [notes, setNotes] = useState<Note[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const base = `users/${user.uid}/notes`

  useEffect(
    () =>
      onValue(
        ref(db, base),
        snap => setNotes(notesFromDb(snap.val())),
        err => setError(err.message),
      ),
    [base],
  )

  // Firebase non accetta valori undefined: vanno tolti prima di salvare.
  const clean = (d: Partial<NoteDraft>) => Object.fromEntries(Object.entries(d).filter(([, v]) => v !== undefined))

  const add = useCallback(
    async (d: NoteDraft) => {
      const now = Date.now()
      await push(ref(db, base), { ...clean(d), createdAt: now, updatedAt: now })
    },
    [base],
  )
  const save = useCallback(
    async (id: string, d: Partial<NoteDraft>) => {
      // Se la data viene tolta in modifica, va cancellata (null); se non è tra i campi, resta com'è.
      const date = 'date' in d ? { date: d.date || null } : {}
      await update(ref(db, `${base}/${id}`), { ...clean(d), ...date, updatedAt: Date.now() })
    },
    [base],
  )
  const del = useCallback((id: string) => remove(ref(db, `${base}/${id}`)), [base])

  return { notes, error, add, save, del }
}
