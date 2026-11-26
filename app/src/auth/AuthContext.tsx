import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  type User,
} from 'firebase/auth'
import { get, ref, serverTimestamp, update } from 'firebase/database'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { auth, db } from '../lib/firebase'
import { isValidInvite, normalizeInvite } from '../lib/invites'
import { forgetDeviceKeys, rememberPassword } from '../lib/keyStore'
import { setVaultKey } from '../lib/vault'
import { AuthContext, AuthError, type AuthState } from './context'

// Il controllo vero lo fanno le regole del database: senza members/{uid} i dati
// in users/{uid} restano inaccessibili. Qui decide solo quale schermata mostrare,
// quindi se la lettura fallisce per un problema di rete si prosegue.
async function readAccess(user: User): Promise<AuthState> {
  try {
    const [member, admin] = await Promise.all([
      get(ref(db, `members/${user.uid}`)),
      get(ref(db, `admins/${user.uid}`)),
    ])
    if (!member.exists()) return { status: 'needsInvite', user }
    return { status: 'ready', user, isAdmin: admin.val() === true }
  } catch {
    return { status: 'ready', user, isAdmin: false }
  }
}

// Una sola scrittura atomica: crea members/{uid} e segna l'invito come usato.
// Le regole la accettano solo se l'invito esiste ed è ancora libero.
async function redeem(user: User, rawInvite: string): Promise<boolean> {
  const code = normalizeInvite(rawInvite)
  if (!isValidInvite(code)) return false
  try {
    await update(ref(db), {
      [`members/${user.uid}`]: { invite: code, email: user.email, joinedAt: serverTimestamp() },
      [`invites/${code}/usedBy`]: user.uid,
    })
    return true
  } catch {
    return false
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' })
  // Durante la registrazione l'account esiste già ma non è ancora membro:
  // evita di mostrare per un attimo la schermata "Serve un invito".
  const registering = useRef(false)

  useEffect(
    () =>
      onAuthStateChanged(auth, async user => {
        if (registering.current) return
        setState(user ? await readAccess(user) : { status: 'signedOut' })
      }),
    [],
  )

  const signIn = useCallback(async (email: string, password: string) => {
    try {
      rememberPassword(email, password)
      await signInWithEmailAndPassword(auth, email.trim(), password)
    } catch {
      throw new AuthError('Email o password errati.')
    }
  }, [])

  const register = useCallback(async (email: string, password: string, invite: string) => {
    if (!isValidInvite(normalizeInvite(invite))) throw new AuthError('Inserisci un codice invito valido.')
    registering.current = true
    try {
      let user: User
      try {
        rememberPassword(email, password)
        user = (await createUserWithEmailAndPassword(auth, email.trim(), password)).user
      } catch (e) {
        const code = (e as { code?: string }).code
        if (code === 'auth/email-already-in-use')
          throw new AuthError('Email già registrata: accedi e inserisci lì il codice invito.')
        if (code === 'auth/weak-password') throw new AuthError('Password troppo debole (almeno 6 caratteri).')
        if (code === 'auth/invalid-email') throw new AuthError('Email non valida.')
        throw new AuthError('Errore nella creazione dell’account.')
      }
      if (!(await redeem(user, invite))) {
        // Invito non valido: elimina l'account appena creato, così non resta un utente orfano.
        await user.delete().catch(() => undefined)
        throw new AuthError('Codice invito non valido o già usato.')
      }
      setState(await readAccess(user))
    } finally {
      registering.current = false
    }
  }, [])

  const claimInvite = useCallback(async (invite: string) => {
    const user = auth.currentUser
    if (!user) throw new AuthError('Sessione scaduta: accedi di nuovo.')
    if (!(await redeem(user, invite))) throw new AuthError('Codice invito non valido o già usato.')
    setState(await readAccess(user))
  }, [])

  const signOut = useCallback(async () => {
    await forgetDeviceKeys()
    setVaultKey('', null)
    await fbSignOut(auth)
  }, [])

  const api = useMemo(
    () => ({ state, signIn, register, claimInvite, signOut }),
    [state, signIn, register, claimInvite, signOut],
  )
  return <AuthContext.Provider value={api}>{children}</AuthContext.Provider>
}
