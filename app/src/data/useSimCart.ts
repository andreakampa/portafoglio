import { onValue, ref, set } from '../lib/vault'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useUser } from '../auth/context'
import type { SimOp } from '../domain/simulation'
import { db } from '../lib/firebase'

type Update = SimOp[] | ((cur: SimOp[]) => SimOp[])
const EMPTY: SimOp[] = []

const valid = (o: unknown): o is SimOp => {
  const x = o as SimOp | null
  return !!x && typeof x.id === 'string' && typeof x.assetId === 'string' && typeof x.qty === 'number' && typeof x.price === 'number'
}

/**
 * Carrello del simulatore, salvato per portafoglio (users/{uid}/settings/simCart/{pid}) come nel sito vecchio:
 * resta dopo una ricarica e si vede da tutti i dispositivi. Lo stesso carrello si riempie dalla pagina Simulatore
 * e dalla finestra "Simula" in Posizioni.
 */
export function useSimCart(pid: string | null): [SimOp[], (u: Update) => void] {
  const { user } = useUser()
  const path = pid ? `users/${user.uid}/settings/simCart/${pid}` : null
  const [state, setState] = useState<{ path: string | null; ops: SimOp[] }>({ path, ops: [] })
  const ops = state.path === path ? state.ops : EMPTY
  const latest = useRef(ops)
  useEffect(() => {
    latest.current = ops
  }, [ops])

  useEffect(() => {
    if (!path) return
    return onValue(
      ref(db, path),
      snap => {
        const v = snap.val() as unknown
        const list = (Array.isArray(v) ? v : Object.values((v ?? {}) as Record<string, unknown>)).filter(valid)
        setState({ path, ops: list.map(o => ({ ...o, commissionEur: Number(o.commissionEur) || 0 })) })
      },
      () => setState({ path, ops: [] }),
    )
  }, [path])

  const update = useCallback(
    (u: Update) => {
      if (!path) return
      const next = typeof u === 'function' ? u(latest.current) : u
      latest.current = next
      setState({ path, ops: next })
      void set(ref(db, path), next.length ? JSON.parse(JSON.stringify(next)) : null)
    },
    [path],
  )
  return [ops, update]
}
