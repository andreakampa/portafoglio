import { useState, type FormEvent } from 'react'
import { AuthError, useAuth } from './context'

type Mode = 'login' | 'register' | 'claim'

const message = (e: unknown) => (e instanceof AuthError ? e.message : 'Qualcosa è andato storto. Riprova.')

export function LoginScreen({ mode: initial = 'login' }: { mode?: Mode }) {
  const { signIn, register, claimInvite, signOut } = useAuth()
  const [mode, setMode] = useState<Mode>(initial)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [invite, setInvite] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const switchTo = (m: Mode) => {
    setMode(m)
    setError('')
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (mode === 'register') {
      if (password !== password2) return setError('Le password non coincidono.')
      if (password.length < 6) return setError('Password troppo corta (almeno 6 caratteri).')
    }
    setBusy(true)
    try {
      if (mode === 'login') await signIn(email, password)
      else if (mode === 'register') await register(email, password, invite)
      else await claimInvite(invite)
    } catch (err) {
      setError(message(err))
    } finally {
      setBusy(false)
    }
  }

  const title = { login: 'Accedi', register: 'Registrati', claim: 'Serve un invito' }[mode]
  const submit = { login: 'Accedi', register: 'Crea account', claim: 'Attiva account' }[mode]

  return (
    <main className="auth">
      <form className="auth-card" onSubmit={onSubmit} noValidate>
        <div className="auth-brand">
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" width={40} height={40} />
          <span>Portafoglio</span>
        </div>
        <h1>{title}</h1>
        {mode === 'claim' && (
          <p className="muted">Il tuo account non è ancora abilitato. Inserisci il codice invito che hai ricevuto.</p>
        )}

        {mode !== 'claim' && (
          <>
            <label>
              Email
              <input type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} />
            </label>
            <label>
              Password
              <input
                type="password"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                required
                value={password}
                onChange={e => setPassword(e.target.value)}
              />
            </label>
          </>
        )}
        {mode === 'register' && (
          <label>
            Conferma password
            <input type="password" autoComplete="new-password" required value={password2} onChange={e => setPassword2(e.target.value)} />
          </label>
        )}
        {mode !== 'login' && (
          <label>
            Codice invito
            <input
              type="text"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder="ABCD-EFGH-JKMN"
              required
              value={invite}
              onChange={e => setInvite(e.target.value)}
            />
          </label>
        )}

        <p className="auth-error" role="alert">{error}</p>

        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? 'Attendi…' : submit}
        </button>

        {mode === 'login' && (
          <button className="btn btn-ghost" type="button" onClick={() => switchTo('register')}>
            Ho un codice invito: registrati
          </button>
        )}
        {mode === 'register' && (
          <button className="btn btn-ghost" type="button" onClick={() => switchTo('login')}>
            Hai già un account? Accedi
          </button>
        )}
        {mode === 'claim' && (
          <button className="btn btn-ghost" type="button" onClick={() => void signOut()}>
            Esci
          </button>
        )}
      </form>
    </main>
  )
}
