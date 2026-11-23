import { onValue, ref, remove, runTransaction, set } from 'firebase/database'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useUser } from '../auth/context'
import type { PacPlan } from '../domain/pac'
import { db } from '../lib/firebase'

/**
 * Piani PAC dell'utente, salvati fuori da `portfolio_state` (users/{uid}/settings/pacPlans):
 * il sito attuale riscrive i portafogli e non deve poterli cancellare.
 */
export function usePacPlans() {
  const { user } = useUser()
  const base = `users/${user.uid}/settings/pacPlans`
  const [plans, setPlans] = useState<PacPlan[] | null>(null)

  useEffect(
    () =>
      onValue(
        ref(db, base),
        snap => setPlans(Object.entries((snap.val() ?? {}) as Record<string, Omit<PacPlan, 'id'>>).map(([id, p]) => ({ ...p, id }))),
        () => setPlans([]),
      ),
    [base],
  )

  const actions = useMemo(
    () => ({
      save: (plan: PacPlan) => {
        const { id, ...rest } = plan
        return set(ref(db, `${base}/${id}`), JSON.parse(JSON.stringify(rest)))
      },
      remove: (id: string) => remove(ref(db, `${base}/${id}`)),
    }),
    [base],
  )

  return { plans, ...actions }
}

/**
 * Segna una rata prevista come da non creare (es. eliminata a mano dai movimenti), così PacRunner non la rigenera.
 * Se il piano non c'è più non fa nulla.
 */
export function usePacSkip() {
  const { user } = useUser()
  return useCallback(
    async (planId: string, date: string) => {
      await runTransaction(ref(db, `users/${user.uid}/settings/pacPlans/${planId}`), cur => {
        if (!cur) return cur
        const plan = cur as { skipDates?: string[] }
        const skip = new Set(plan.skipDates ?? [])
        if (skip.has(date)) return undefined
        return { ...plan, skipDates: [...skip, date].sort() }
      })
    },
    [user.uid],
  )
}
