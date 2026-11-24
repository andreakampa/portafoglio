// Impostazioni: cambio password e pulizia della cache dei dati di mercato (come il sito vecchio).
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from 'firebase/auth'
import { useState, type FormEvent } from 'react'
import { useUser } from '../auth/context'
import { isMarketCacheKey, passwordError, validatePassword, type PasswordForm } from '../domain/account'
import { toast } from '../lib/toast'

export function PasswordCard() {
  const { user } = useUser()
  const [open, setOpen] = useState(false)
  const [f, setF] = useState<PasswordForm>({ current: '', next: '', repeat: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    const problem = validatePassword(f)
    if (problem) return setError(problem)
    if (!user.email) return setError('Account senza email: non si può cambiare la password da qui.')
    setBusy(true)
    setError('')
    try {
      // Firebase chiede di confermare la password attuale prima di cambiarla.
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, f.current))
      await updatePassword(user, f.next)
      setF({ current: '', next: '', repeat: '' })
      setOpen(false)
      toast('Password cambiata')
    } catch (err) {
      setError(passwordError((err as { code?: string }).code ?? ''))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card">
      <h2>Password</h2>
      {!open ? (
        <button type="button" className="btn btn-ghost" onClick={() => setOpen(true)}>Cambia password</button>
      ) : (
        <form className="note-form" onSubmit={submit}>
          <label>Password attuale<input type="password" autoComplete="current-password" value={f.current} onChange={e => setF({ ...f, current: e.target.value })} /></label>
          <label>Nuova password<input type="password" autoComplete="new-password" value={f.next} onChange={e => setF({ ...f, next: e.target.value })} /></label>
          <label>Ripeti la nuova password<input type="password" autoComplete="new-password" value={f.repeat} onChange={e => setF({ ...f, repeat: e.target.value })} /></label>
          <p className="auth-error" role="alert">{error}</p>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Cambio…' : 'Cambia password'}</button>
            <button type="button" className="btn btn-ghost" onClick={() => { setOpen(false); setError('') }}>Annulla</button>
          </div>
        </form>
      )}
    </div>
  )
}

export function CacheCard() {
  const clear = () => {
    if (!confirm('Svuotare prezzi, cambi e dividendi salvati su questo dispositivo? Si riscaricano subito.')) return
    try {
      const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).filter((k): k is string => !!k && isMarketCacheKey(k))
      for (const k of keys) localStorage.removeItem(k)
    } catch {
      /* storage non disponibile */
    }
    location.reload()
  }
  return (
    <div className="card">
      <h2>Dati di mercato</h2>
      <p className="muted small">Prezzi, cambi Banca d'Italia e dividendi restano salvati su questo dispositivo per andare più veloci. Se un numero sembra vecchio o sbagliato, svuotali.</p>
      <button type="button" className="btn btn-ghost" onClick={clear}>Svuota la cache</button>
    </div>
  )
}
