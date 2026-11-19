import { onValue, ref } from 'firebase/database'
import { useEffect, useState } from 'react'
import { useUser } from '../auth/context'
import type { PortfolioState } from '../domain/portfolioState'
import { db } from '../lib/firebase'

type Result =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: PortfolioState | null }

/** Stato dei portafogli dell'utente, aggiornato in tempo reale (anche da altri dispositivi). */
export function usePortfolioState(): Result {
  const { user } = useUser()
  const [result, setResult] = useState<Result>({ status: 'loading' })

  useEffect(
    () =>
      onValue(
        ref(db, `users/${user.uid}/portfolio_state`),
        snap => setResult({ status: 'ready', data: snap.val() as PortfolioState | null }),
        err => setResult({ status: 'error', message: err.message }),
      ),
    [user.uid],
  )

  return result
}
