import { sendPasswordResetEmail } from 'firebase/auth'
import { useState, type FormEvent } from 'react'
import { auth } from '../lib/firebase'
import { PrivacyText } from '../components/PrivacyText'
import { inviteFromUrl } from '../lib/invites'
import { AuthError, useAuth } from './context'

type Mode = 'login' | 'register' | 'claim' | 'reset'

const message = (e: unknown) => (e instanceof AuthError ? e.message : 'Qualcosa è andato storto. Riprova.')

export function LoginScreen({ mode: initial = 'login' }: { mode?: Mode }) {
  const { signIn, register, claimInvite, signOut } = useAuth()
  // Link d'invito (…/v2/?invito=CODICE): si apre direttamente la registrazione con il codice già scritto.
  const linked = inviteFromUrl(window.location.search)
  const [mode, setMode] = useState<Mode>(initial === 'login' && linked ? 'register' : initial)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [invite, setInvite] = useState(linked ?? '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [info, setInfo] = useState('')

  const switchTo = (m: Mode) => {
    setMode(m)
    setError('')
    setInfo('')
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (mode === 'register') {
      if (password !== password2) return setError('Le password non coincidono.')
      if (password.length < 6) return setError('Password troppo corta (almeno 6 caratteri).')
    }
    if (mode === 'reset') {
      if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError('Scrivi l\'email con cui ti sei registrato.')
      setBusy(true)
      try {
        await sendPasswordResetEmail(auth, email.trim())
      } catch (err) {
        // Stesso messaggio se l'email non esiste: non si rivela chi è iscritto.
        if ((err as { code?: string }).code === 'auth/too-many-requests') {
          setBusy(false)
          return setError('Troppi tentativi: riprova tra qualche minuto.')
        }
      }
      setBusy(false)
      return setInfo('Se l\'email è registrata, ti abbiamo mandato un link per scegliere una nuova password. Controlla anche lo spam.')
    }
    setBusy(true)
    try {
      if (mode === 'login') await signIn(email, password)
      else if (mode === 'register') await register(email, password, invite)
      else await claimInvite(invite)
      // Il codice non serve più nell'indirizzo (e non deve restare nella cronologia).
      if (linked) window.history.replaceState(null, '', window.location.pathname + window.location.hash)
    } catch (err) {
      setError(message(err))
    } finally {
      setBusy(false)
    }
  }

  const title = { login: 'Accedi', register: 'Registrati', claim: 'Serve un invito', reset: 'Password dimenticata' }[mode]
  const submit = { login: 'Accedi', register: 'Crea account', claim: 'Attiva account', reset: 'Mandami il link' }[mode]

  return (
    <main className="auth">
      <form className="auth-card" onSubmit={onSubmit} noValidate>
        <div className="auth-brand">
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" width={40} height={40} />
          <span>Gruzzolo</span>
        </div>
        <h1>{title}</h1>
        {mode === 'claim' && (
          <p className="muted">Il tuo account non è ancora abilitato. Inserisci il codice invito che hai ricevuto.</p>
        )}

        {mode === 'reset' && <p className="muted">Ti mandiamo un'email con il link per scegliere una nuova password.</p>}
        {mode !== 'claim' && (
          <>
            <label>
              Email
              <input type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} />
            </label>
          </>
        )}
        {(mode === 'login' || mode === 'register') && (
          <>
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
        {(mode === 'register' || mode === 'claim') && (
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

        {(mode === 'register' || mode === 'claim') && (
          <details className="privacy-box">
            <summary className="small">Registrandoti accetti l'<b>informativa privacy</b>: i tuoi dati sono cifrati e nessuno, nemmeno chi gestisce il sito, può leggerli. Leggila</summary>
            <PrivacyText />
          </details>
        )}

        <p className="auth-error" role="alert">{error}</p>
        {info && <p className="small" role="status">{info}</p>}

        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? 'Attendi…' : submit}
        </button>

        {mode === 'login' && (
          <>
            <button className="btn btn-ghost" type="button" onClick={() => switchTo('register')}>
              Ho un codice invito: registrati
            </button>
            <button className="linklike" type="button" onClick={() => switchTo('reset')}>
              Password dimenticata?
            </button>
          </>
        )}
        {mode === 'reset' && (
          <button className="btn btn-ghost" type="button" onClick={() => switchTo('login')}>
            Torna all'accesso
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
