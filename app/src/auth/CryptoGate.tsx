// Cifratura, passo 2: prima di entrare nell'app un amico invitato deve avere la chiave dei dati sbloccata.
// - prima volta: si crea la chiave e si mostra la chiave di recupero da salvare;
// - accessi successivi: la chiave si apre con la password (e resta su questo dispositivo fino a "Esci");
// - password reimpostata via email: si apre con la chiave di recupero e si richiude con la password nuova.
// L'amministratore resta in chiaro (chiave null).
import { EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth'
import { get, ref, set } from 'firebase/database'
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { createKeyring, isRecoveryCode, normalizeRecoveryCode, rewrapPassword, unlockWithPassword, unlockWithRecovery, type KeyEnvelope } from '../lib/crypto'
import { db } from '../lib/firebase'
import { loadDeviceKey, storeDeviceKey, takePassword } from '../lib/keyStore'
import { setVaultKey } from '../lib/vault'
import { useAuth, useUser } from './context'
import { DataKeyContext, envelopePath } from './dataKey'

type State =
  | { s: 'loading' }
  | { s: 'error' }
  | { s: 'plain' }
  | { s: 'setup' }
  | { s: 'showCode'; keyring: Awaited<ReturnType<typeof createKeyring>> }
  | { s: 'locked'; envelope: KeyEnvelope }
  | { s: 'ready'; key: CryptoKey }

export function CryptoGate({ children }: { children: ReactNode }) {
  const { user, isAdmin } = useUser()
  const [state, setRaw] = useState<State>({ s: 'loading' })
  // La chiave va data al livello dati PRIMA che l'app parta (i figli leggono subito).
  const setState = useCallback((n: State) => {
    if (n.s === 'ready') setVaultKey(user.uid, n.key)
    else setVaultKey(user.uid, null)
    setRaw(n)
  }, [user.uid])
  // Una sola partenza per utente (in sviluppo React lancia gli effetti due volte, e la password si legge una volta sola).
  const startedFor = useRef<string | null>(null)

  const start = useCallback(async () => {
    if (isAdmin) return setState({ s: 'plain' })
    try {
      const envelope = (await get(ref(db, envelopePath(user.uid)))).val() as KeyEnvelope | null
      const typed = takePassword(user.email)
      if (!envelope) {
        if (typed) return setState({ s: 'showCode', keyring: await createKeyring(typed) })
        return setState({ s: 'setup' })
      }
      const saved = await loadDeviceKey(user.uid)
      if (saved) return setState({ s: 'ready', key: saved })
      if (typed) {
        try {
          const key = await unlockWithPassword(envelope, typed)
          await storeDeviceKey(user.uid, key)
          return setState({ s: 'ready', key })
        } catch {
          /* password nuova dopo un reset: serve la chiave di recupero */
        }
      }
      setState({ s: 'locked', envelope })
    } catch {
      setState({ s: 'error' })
    }
  }, [isAdmin, user, setState])

  useEffect(() => {
    if (startedFor.current === user.uid) return
    startedFor.current = user.uid
    void start()
  }, [start, user.uid])

  switch (state.s) {
    case 'loading':
      return <div className="splash" aria-busy="true" />
    case 'error':
      return (
        <Card title="Connessione non riuscita">
          <p className="muted">Non riesco a leggere i tuoi dati. Controlla la connessione e riprova.</p>
          <button type="button" className="btn btn-primary" onClick={() => { setState({ s: 'loading' }); void start() }}>Riprova</button>
        </Card>
      )
    case 'plain':
      return <DataKeyContext.Provider value={null}>{children}</DataKeyContext.Provider>
    case 'ready':
      return <DataKeyContext.Provider value={state.key}>{children}</DataKeyContext.Provider>
    case 'setup':
      return <SetupForm onReady={keyring => setState({ s: 'showCode', keyring })} />
    case 'showCode':
      return (
        <ShowRecoveryCode
          code={state.keyring.recoveryCode}
          onConfirm={async () => {
            await set(ref(db, envelopePath(user.uid)), state.keyring.envelope)
            await storeDeviceKey(user.uid, state.keyring.dataKey)
            setState({ s: 'ready', key: state.keyring.dataKey })
          }}
        />
      )
    case 'locked':
      return <UnlockForm envelope={state.envelope} onReady={key => setState({ s: 'ready', key })} />
  }
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  const { signOut } = useAuth()
  return (
    <main className="auth">
      <div className="auth-card">
        <div className="auth-brand">
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" width={40} height={40} />
          <span>Gruzzolo</span>
        </div>
        <h1>{title}</h1>
        {children}
        <button type="button" className="linklike" onClick={() => void signOut()}>Esci</button>
      </div>
    </main>
  )
}

/** Prima volta senza password a portata (es. invito inserito dopo l'accesso): si chiede e si verifica. */
function SetupForm({ onReady }: { onReady: (k: Awaited<ReturnType<typeof createKeyring>>) => void }) {
  const { user } = useUser()
  const [pwd, setPwd] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email ?? '', pwd))
      onReady(await createKeyring(pwd))
    } catch {
      setError('Password errata.')
      setBusy(false)
    }
  }
  return (
    <Card title="Proteggi i tuoi dati">
      <p className="muted">
        I tuoi portafogli vengono cifrati qui sul tuo dispositivo: nessun altro, nemmeno chi gestisce il sito, può leggerli.
        Conferma la password per creare la tua chiave.
      </p>
      <form className="note-form" onSubmit={submit}>
        <label>Password<input type="password" autoComplete="current-password" value={pwd} onChange={e => setPwd(e.target.value)} /></label>
        <p className="auth-error" role="alert">{error}</p>
        <button type="submit" className="btn btn-primary" disabled={busy || !pwd}>{busy ? 'Attendi…' : 'Continua'}</button>
      </form>
    </Card>
  )
}

/** La chiave di recupero si vede solo adesso: va salvata prima di entrare. */
function ShowRecoveryCode({ code, onConfirm }: { code: string; onConfirm: () => Promise<void> }) {
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const download = () => {
    const blob = new Blob([`Gruzzolo, chiave di recupero\n\n${code}\n\nServe solo se dimentichi la password. Conservala in un posto sicuro e non darla a nessuno.\n`], { type: 'text/plain' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'gruzzolo-chiave-di-recupero.txt'
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
  }
  const copy = () => void navigator.clipboard?.writeText(code).catch(() => undefined)
  return (
    <Card title="La tua chiave di recupero">
      <p className="muted">
        Se dimentichi la password, è l'<b>unico</b> modo per riaprire i tuoi dati: nessuno, nemmeno chi gestisce il sito, può recuperarli al posto tuo.
        Scrivila su carta o salvala in un posto sicuro.
      </p>
      <p className="recovery-code" aria-label="Chiave di recupero"><code>{code}</code></p>
      <div className="form-actions">
        <button type="button" className="btn btn-ghost" onClick={download}>Scarica file</button>
        <button type="button" className="btn btn-ghost" onClick={copy}>Copia</button>
        <button type="button" className="btn btn-ghost" onClick={() => window.print()}>Stampa</button>
      </div>
      <label className="check">
        <input type="checkbox" checked={saved} onChange={e => setSaved(e.target.checked)} />
        <span>L'ho salvata in un posto sicuro</span>
      </label>
      <p className="auth-error" role="alert">{error}</p>
      <button
        type="button"
        className="btn btn-primary"
        disabled={!saved || busy}
        onClick={async () => {
          setBusy(true)
          try {
            await onConfirm()
          } catch {
            setError('Salvataggio non riuscito: controlla la connessione e riprova.')
            setBusy(false)
          }
        }}
      >
        {busy ? 'Attendi…' : 'Entra'}
      </button>
    </Card>
  )
}

/** Accesso su un dispositivo nuovo, oppure dopo una password reimpostata via email. */
function UnlockForm({ envelope, onReady }: { envelope: KeyEnvelope; onReady: (k: CryptoKey) => void }) {
  const { user } = useUser()
  const [mode, setMode] = useState<'password' | 'recovery'>('password')
  const [pwd, setPwd] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      if (mode === 'password') {
        const key = await unlockWithPassword(envelope, pwd)
        await storeDeviceKey(user.uid, key)
        return onReady(key)
      }
      const c = normalizeRecoveryCode(code)
      if (!isRecoveryCode(c)) throw new Error('formato')
      // La password scritta qui è quella con cui sei appena entrato: si verifica e diventa la nuova serratura.
      try {
        await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email ?? '', pwd))
      } catch {
        setBusy(false)
        return setError('La password non è quella con cui hai appena fatto l\'accesso.')
      }
      const key = await unlockWithRecovery(envelope, c)
      await set(ref(db, envelopePath(user.uid)), await rewrapPassword(envelope, key, pwd))
      await storeDeviceKey(user.uid, key)
      onReady(key)
    } catch {
      setError(mode === 'password' ? 'Password errata. Se l\'hai reimpostata via email, usa la chiave di recupero.' : 'Chiave di recupero errata.')
      setBusy(false)
    }
  }

  return (
    <Card title={mode === 'password' ? 'Sblocca i tuoi dati' : 'Usa la chiave di recupero'}>
      <p className="muted">
        {mode === 'password'
          ? 'Su questo dispositivo serve la password per aprire i tuoi dati cifrati.'
          : 'Hai reimpostato la password? Scrivi la chiave di recupero e la password con cui sei appena entrato: da ora i dati si apriranno con quella.'}
      </p>
      <form className="note-form" onSubmit={submit}>
        {mode === 'recovery' && (
          <label>Chiave di recupero<input autoCapitalize="characters" spellCheck={false} placeholder="ABCD-EFGH-…" value={code} onChange={e => setCode(e.target.value)} /></label>
        )}
        <label>{mode === 'password' ? 'Password' : 'Password attuale'}<input type="password" autoComplete="current-password" value={pwd} onChange={e => setPwd(e.target.value)} /></label>
        <p className="auth-error" role="alert">{error}</p>
        <button type="submit" className="btn btn-primary" disabled={busy || !pwd || (mode === 'recovery' && !code)}>{busy ? 'Attendi…' : 'Sblocca'}</button>
      </form>
      <button type="button" className="linklike" onClick={() => { setMode(mode === 'password' ? 'recovery' : 'password'); setError('') }}>
        {mode === 'password' ? 'Ho reimpostato la password / uso la chiave di recupero' : 'Torna alla password'}
      </button>
    </Card>
  )
}
