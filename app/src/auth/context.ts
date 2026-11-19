import type { User } from 'firebase/auth'
import { createContext, useContext } from 'react'

export type AuthState =
  | { status: 'loading' }
  | { status: 'signedOut' }
  | { status: 'needsInvite'; user: User }
  | { status: 'ready'; user: User; isAdmin: boolean }

export interface AuthApi {
  state: AuthState
  signIn(email: string, password: string): Promise<void>
  register(email: string, password: string, invite: string): Promise<void>
  claimInvite(invite: string): Promise<void>
  signOut(): Promise<void>
}

/** Errore con un messaggio già pronto da mostrare all'utente. */
export class AuthError extends Error {}

export const AuthContext = createContext<AuthApi | null>(null)

export function useAuth(): AuthApi {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth va usato dentro <AuthProvider>')
  return ctx
}

/** Utente autenticato e abilitato: da usare solo nelle pagine dietro al login. */
export function useUser() {
  const { state } = useAuth()
  if (state.status !== 'ready') throw new Error('useUser va usato solo con utente abilitato')
  return { user: state.user, isAdmin: state.isAdmin }
}
