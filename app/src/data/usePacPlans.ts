import { onValue, ref, remove, set } from 'firebase/database'
import { useEffect, useMemo, useState } from 'react'
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
