import { onValue, ref, update } from 'firebase/database'
import { useEffect, useMemo, useState } from 'react'
import { useUser } from '../auth/context'
import type { BonusGrant } from '../domain/bonusShares'
import { db } from '../lib/firebase'

/** Azioni premio per portafoglio (pid → elenco). */
export type GrantsByPortfolio = Record<string, BonusGrant[]>

/**
 * Azioni premio del broker, salvate fuori da `portfolio_state` (users/{uid}/settings/bonusGrants/{pid}/{id}):
 * il sito attuale e la sincronizzazione riscrivono i portafogli e non devono cancellarle.
 * Si aggiungono importando il rendiconto IBKR. null = in caricamento.
 */
export function useBonusGrants() {
  const { user } = useUser()
  const base = `users/${user.uid}/settings/bonusGrants`
  const [grants, setGrants] = useState<GrantsByPortfolio | null>(null)

  useEffect(
    () =>
      onValue(
        ref(db, base),
        snap => {
          const raw = (snap.val() ?? {}) as Record<string, Record<string, Omit<BonusGrant, 'id'>>>
          setGrants(Object.fromEntries(Object.entries(raw).map(([pid, list]) => [pid, Object.entries(list).map(([id, g]) => ({ ...g, id }))])))
        },
        () => setGrants({}),
      ),
    [base],
  )

  const save = useMemo(
    () => (pid: string, list: BonusGrant[]) =>
      update(ref(db, `${base}/${pid}`), Object.fromEntries(list.map(({ id, ...g }) => [id, JSON.parse(JSON.stringify(g))]))),
    [base],
  )

  return { grants, save }
}
