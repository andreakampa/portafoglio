// Avvisi a ogni accesso (sospensione, chiusura del sito), "Scarica i miei dati", "Elimina il mio account"
// e, per l'admin, membri (sospendi, riattiva, cancella) e annuncio di chiusura.
import { deleteUser, EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth'
import { ref, remove, set, update } from 'firebase/database'
import { useState, type FormEvent } from 'react'
import { useUser } from '../auth/context'
import {
  bannersFor, canPurge, closingMail, closingNotice, dateIt, isSuspended,
  suspension, suspensionMail, type MemberInfo, type SiteNotice,
} from '../domain/accountLifecycle'
import { APP_URL, downloadMyData, useMyMember, useNode } from '../data/accountData'
import { db } from '../lib/firebase'
import { forgetDeviceKeys } from '../lib/keyStore'
import { toast } from '../lib/toast'

/** In cima a ogni pagina, finché vale: sospensione dell'account e chiusura annunciata del sito. */
export function AccountNotices() {
  const { user } = useUser()
  const member = useMyMember()
  const notice = useNode<SiteNotice>('notice')
  const [now] = useState(() => Date.now())
  const banners = bannersFor(member, notice, now)
  if (!banners.length) return null
  return (
    <>
      {banners.map(b => (
        <div key={b.title} className={`card ${b.tone}`} role="alert">
          <b>{b.title}</b>
          <p>{b.text}</p>
          <button type="button" className="btn btn-primary" onClick={() => void downloadMyData(user.uid, user.email)}>Scarica i miei dati</button>
        </div>
      ))}
    </>
  )
}

/** Impostazioni: i propri dati (per tutti). */
export function MyDataCard() {
  const { user, isAdmin } = useUser()
  const [deleting, setDeleting] = useState(false)
  const [pwd, setPwd] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function download() {
    try {
      await downloadMyData(user.uid, user.email)
      toast('File scaricato')
    } catch {
      toast('Download non riuscito: riprova')
    }
  }

  async function deleteAccount(e: FormEvent) {
    e.preventDefault()
    if (!user.email) return
    setBusy(true)
    setError('')
    try {
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, pwd))
    } catch {
      setBusy(false)
      return setError('Password errata.')
    }
    try {
      // Una sola scrittura: dati e iscrizione spariscono insieme. Poi l'account di accesso.
      await update(ref(db), { [`users/${user.uid}`]: null, [`members/${user.uid}`]: null })
      await forgetDeviceKeys()
      await deleteUser(user)
    } catch {
      setError('Cancellazione non riuscita: riprova o scrivi ad Andrea.')
      setBusy(false)
    }
  }

  return (
    <div className="card">
      <h2>I miei dati</h2>
      <p className="muted small">
        Un file con tutti i tuoi dati (portafogli, movimenti, note, impostazioni), da conservare o da aprire con un altro programma.
      </p>
      <button type="button" className="btn btn-ghost" onClick={() => void download()}>Scarica i miei dati</button>
      {!isAdmin && (!deleting ? (
        <p><button type="button" className="linklike neg" onClick={() => setDeleting(true)}>Elimina il mio account</button></p>
      ) : (
        <form className="note-form" onSubmit={deleteAccount}>
          <p className="small"><b>Si cancella tutto subito e per sempre</b>: portafogli, movimenti, note e account. Prima scarica i tuoi dati se ti servono.</p>
          <label>Password, per conferma<input type="password" autoComplete="current-password" value={pwd} onChange={e => setPwd(e.target.value)} /></label>
          <p className="auth-error" role="alert">{error}</p>
          <div className="form-actions">
            <button type="submit" className="btn btn-danger" disabled={busy || !pwd}>{busy ? 'Cancello…' : 'Elimina definitivamente'}</button>
            <button type="button" className="btn btn-ghost" onClick={() => { setDeleting(false); setError(''); setPwd('') }}>Annulla</button>
          </div>
        </form>
      ))}
    </div>
  )
}

/** Impostazioni (solo admin): chi è iscritto e cosa succede ai suoi dati. */
export function MembersCard() {
  const { user } = useUser()
  const members = useNode<Record<string, MemberInfo>>('members') ?? {}
  const notice = useNode<SiteNotice>('notice')
  const [closingMsg, setClosingMsg] = useState('')
  const [now] = useState(() => Date.now())
  const rows = Object.entries(members).filter(([uid]) => uid !== user.uid).sort(([, a], [, b]) => (a.email ?? '').localeCompare(b.email ?? ''))
  const emails = rows.map(([, m]) => m.email).filter((e): e is string => !!e)

  const suspend = async (uid: string, m: MemberInfo) => {
    if (!confirm(`Sospendere ${m.email}? Potrà solo consultare e scaricare i suoi dati per 30 giorni, poi potrai cancellarli.`)) return
    const s = suspension(Date.now())
    await update(ref(db, `members/${uid}`), s)
    if (m.email) window.location.assign(suspensionMail(m.email, s, APP_URL))
  }
  const resume = async (uid: string) => {
    await update(ref(db, `members/${uid}`), { suspendedAt: null, deleteAfter: null })
    toast('Accesso riattivato')
  }
  const purge = async (uid: string, m: MemberInfo) => {
    if (!confirm(`Cancellare per sempre tutti i dati di ${m.email}? Non si può annullare.`)) return
    try {
      await update(ref(db), { [`users/${uid}`]: null, [`members/${uid}`]: null })
      toast('Dati cancellati. Resta solo l\'account di accesso (email): si toglie da Firebase → Authentication.')
    } catch {
      toast('Cancellazione non riuscita')
    }
  }
  const announce = async () => {
    if (!confirm('Annunciare la chiusura del sito tra 60 giorni? Tutti vedranno l\'avviso al prossimo accesso.')) return
    const n = closingNotice(Date.now(), closingMsg)
    await set(ref(db, 'notice'), n)
    setClosingMsg('')
    if (emails.length) window.location.assign(closingMail(emails, n, APP_URL))
  }

  return (
    <div className="card">
      <h2>Membri</h2>
      <p className="muted small">
        Sospendere toglie la possibilità di modificare; l'amico vede l'avviso a ogni accesso e può scaricare i suoi dati per 30 giorni.
        Dopo puoi cancellarli. Tu non puoi leggere i dati dei membri dall'app.
      </p>
      {rows.length === 0 ? <p className="muted small">Nessun altro iscritto.</p> : (
        <ul className="plain-list">
          {rows.map(([uid, m]) => (
            <li key={uid}>
              <span>
                {m.email ?? 'senza email'}
                <br />
                <small className={isSuspended(m) ? 'neg' : 'muted'}>
                  {isSuspended(m) && m.deleteAfter != null
                    ? canPurge(m, now) ? 'sospeso · periodo finito, si può cancellare' : `sospeso · cancellabile dal ${dateIt(m.deleteAfter)}`
                    : m.joinedAt ? `iscritto dal ${dateIt(m.joinedAt)}` : 'attivo'}
                </small>
              </span>
              <span className="note-actions">
                {m.email && <a className="linklike" href={`mailto:${m.email}`}>Scrivi</a>}
                {!isSuspended(m) && <button type="button" className="linklike neg" onClick={() => void suspend(uid, m)}>Sospendi</button>}
                {isSuspended(m) && <button type="button" className="linklike" onClick={() => void resume(uid)}>Riattiva</button>}
                {isSuspended(m) && m.email && m.suspendedAt != null && m.deleteAfter != null && (
                  <a className="linklike" href={suspensionMail(m.email, { suspendedAt: m.suspendedAt, deleteAfter: m.deleteAfter }, APP_URL)}>Email di avviso</a>
                )}
                {canPurge(m, now) && <button type="button" className="linklike neg" onClick={() => void purge(uid, m)}>Cancella i dati</button>}
              </span>
            </li>
          ))}
        </ul>
      )}

      <h3>Chiusura del sito</h3>
      {notice?.closesAt != null ? (
        <>
          <p className="small">Chiusura annunciata per il <b>{dateIt(notice.closesAt)}</b>. Tutti vedono l'avviso a ogni accesso.</p>
          <div className="form-actions">
            {emails.length > 0 && <a className="btn btn-ghost" href={closingMail(emails, notice, APP_URL)}>Email a tutti</a>}
            <button type="button" className="btn btn-ghost" onClick={() => void remove(ref(db, 'notice'))}>Annulla la chiusura</button>
          </div>
        </>
      ) : (
        <>
          <p className="muted small">Avvisa tutti con 60 giorni di anticipo: avviso nell'app e email (in copia nascosta) già scritta.</p>
          <div className="inline-pair">
            <input value={closingMsg} onChange={e => setClosingMsg(e.target.value)} placeholder="Messaggio (facoltativo)" maxLength={300} aria-label="Messaggio di chiusura" />
            <button type="button" className="btn btn-danger" onClick={() => void announce()}>Annuncia la chiusura</button>
          </div>
        </>
      )}
    </div>
  )
}
