// Lettura dei dati dell'account: proprio record in members, avviso globale, copia completa dei dati.
import { get, onValue, ref } from 'firebase/database'
import { useEffect, useState } from 'react'
import { useUser } from '../auth/context'
import { exportFileName, exportPayload, type MemberInfo } from '../domain/accountLifecycle'
import { db } from '../lib/firebase'

export const APP_URL = 'https://andreakampa.github.io/portafoglio/v2/'

export function useNode<T>(path: string | null): T | null {
  const [v, setV] = useState<T | null>(null)
  useEffect(() => (path ? onValue(ref(db, path), s => setV((s.val() ?? null) as T | null), () => setV(null)) : undefined), [path])
  return v
}

/** Il proprio record in members/{uid}: dice se l'account è sospeso. */
export function useMyMember(): MemberInfo | null {
  const { user } = useUser()
  return useNode<MemberInfo>(`members/${user.uid}`)
}

export async function downloadMyData(uid: string, email: string | null) {
  const snap = await get(ref(db, `users/${uid}`))
  const now = Date.now()
  const blob = new Blob([JSON.stringify(exportPayload(email, snap.val(), now), null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = exportFileName(now)
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
}

