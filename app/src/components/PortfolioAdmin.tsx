import { onValue, ref, remove, serverTimestamp, set, update } from '../lib/vault'
import { useEffect, useState, type FormEvent } from 'react'
import { useUser } from '../auth/context'
import { useIbkrSync } from '../data/useIbkrSync'
import { usePortfolioState } from '../data/usePortfolioState'
import { newPortfolio, newPortfolioId, summarizePortfolios, type TaxRegime } from '../domain/portfolioState'
import { db } from '../lib/firebase'
import { inviteLink, newInviteCode } from '../lib/invites'

/** Crea un portafoglio (e lo rende attivo se è il primo). */
export function NewPortfolioForm({ first = false, onDone }: { first?: boolean; onDone?: () => void }) {
  const { user } = useUser()
  const [name, setName] = useState('')
  const [regime, setRegime] = useState<TaxRegime>('amministrato')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return setError('Dai un nome al portafoglio (es. il nome della banca o del broker).')
    setBusy(true)
    try {
      const id = newPortfolioId()
      await update(ref(db, `users/${user.uid}/portfolio_state`), {
        [`portfolios/${id}`]: newPortfolio(name, regime, id),
        ...(first ? { activePortfolioId: id } : {}),
      })
      setName('')
      onDone?.()
    } catch {
      setError('Salvataggio non riuscito: controlla la connessione e riprova.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="note-form" onSubmit={submit}>
      <label>Nome<input value={name} onChange={e => setName(e.target.value)} placeholder="es. Fineco, Directa, Interactive Brokers" maxLength={40} /></label>
      <fieldset className="regime-choice">
        <legend>Come paghi le tasse su questo conto?</legend>
        <label className="check">
          <input type="radio" name="regime" checked={regime === 'amministrato'} onChange={() => setRegime('amministrato')} />
          <span><b>Amministrato</b>: banca o broker italiano, le tasse le trattiene lui a ogni vendita (la scelta più comune).</span>
        </label>
        <label className="check">
          <input type="radio" name="regime" checked={regime === 'dichiarativo'} onChange={() => setRegime('dichiarativo')} />
          <span><b>Dichiarativo</b>: broker estero (es. Interactive Brokers, Degiro), le tasse le paghi tu con la dichiarazione dei redditi.</span>
        </label>
      </fieldset>
      <p className="auth-error" role="alert">{error}</p>
      <div className="form-actions"><button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Creo…' : 'Crea portafoglio'}</button></div>
    </form>
  )
}

/** Primo accesso: nessun portafoglio ancora. */
export function WelcomeCard() {
  return (
    <div className="card">
      <h2>Benvenuto!</h2>
      <p className="small">Tre passi per iniziare:</p>
      <ol className="small onboarding-steps">
        <li><b>Crea il primo portafoglio</b> qui sotto: uno per ogni banca o broker.</li>
        <li>Vai in <b>Movimenti → + Nuovo movimento</b> e inserisci acquisti e vendite (data, quantità, prezzo, commissioni).</li>
        <li>Guarda <b>Posizioni</b> e <b>Fiscale</b>: prezzo medio, risultato e tasse si calcolano da soli. I tuoi dati li vedi solo tu.</li>
      </ol>
      <NewPortfolioForm first />
    </div>
  )
}

/** Impostazioni: portafogli (rinomina e nuovo). */
export function PortfoliosCard() {
  const { user } = useUser()
  const state = usePortfolioState()
  const [adding, setAdding] = useState(false)
  const list = state.status === 'ready' ? summarizePortfolios(state.data) : []
  const sync = useIbkrSync()
  const [autoSync, setAutoSync] = useState<boolean | null>(null)
  useEffect(() => onValue(ref(db, `users/${user.uid}/settings/ibkrAutoSync`), s => setAutoSync(s.val() !== false), () => setAutoSync(true)), [user.uid])
  const rename = async (id: string, current: string) => {
    const name = prompt('Nuovo nome del portafoglio', current)?.trim()
    if (name) await set(ref(db, `users/${user.uid}/portfolio_state/portfolios/${id}/name`), name.slice(0, 40))
  }
  return (
    <div className="card">
      <h2>Portafogli</h2>
      <ul className="plain-list">
        {list.map(p => (
          <li key={p.id}>
            <span>{p.name}<br /><small className="muted">regime {p.taxRegime} · {p.assets} titoli</small></span>
            <button type="button" className="linklike" onClick={() => void rename(p.id, p.name)}>Rinomina</button>
            {/* Solo sul portafoglio che la sincronizzazione IBKR aggiorna: sugli altri broker non ha senso. */}
            {sync?.portfolioId === p.id && autoSync != null && (
              <label className="check small ibkr-auto">
                <input
                  type="checkbox"
                  checked={autoSync}
                  onChange={e => void set(ref(db, `users/${user.uid}/settings/ibkrAutoSync`), e.target.checked)}
                />
                <span>
                  Scarica i movimenti da IBKR ogni mattina
                  <br />
                  <span className="muted">{autoSync ? 'Attivo: ogni mattina presto arrivano operazioni, dividendi e interessi. Puoi sempre inserire anche a mano.' : 'In pausa: i movimenti si inseriscono solo a mano.'}</span>
                </span>
              </label>
            )}
          </li>
        ))}
      </ul>
      {adding ? <NewPortfolioForm onDone={() => setAdding(false)} /> : <button type="button" className="btn btn-ghost" onClick={() => setAdding(true)}>+ Nuovo portafoglio</button>}
    </div>
  )
}

interface Invite {
  createdAt?: number
  createdBy?: string
  note?: string
  usedBy?: string
}

/** Impostazioni (solo admin): inviti monouso per amici e parenti. */
export function InvitesCard() {
  const { user } = useUser()
  const [invites, setInvites] = useState<Record<string, Invite> | null>(null)
  const [members, setMembers] = useState<Record<string, { email?: string }>>({})
  const [note, setNote] = useState('')
  const [msg, setMsg] = useState('')

  useEffect(() => onValue(ref(db, 'invites'), s => setInvites((s.val() ?? {}) as Record<string, Invite>), () => setInvites({})), [])
  useEffect(() => onValue(ref(db, 'members'), s => setMembers((s.val() ?? {}) as Record<string, { email?: string }>), () => setMembers({})), [])

  const share = async (code: string) => {
    const link = inviteLink(code)
    const text = `Ti invito su Portafoglio: apri ${link} e registrati (codice ${code}).`
    try {
      if (navigator.share) await navigator.share({ title: 'Invito a Portafoglio', text, url: link })
      else {
        await navigator.clipboard.writeText(text)
        setMsg('Messaggio con il link copiato: incollalo su WhatsApp o in una mail.')
      }
    } catch {
      /* condivisione annullata */
    }
  }
  const create = async () => {
    const code = newInviteCode()
    await set(ref(db, `invites/${code}`), { createdBy: user.uid, createdAt: serverTimestamp(), ...(note.trim() ? { note: note.trim().slice(0, 60) } : {}) })
    setNote('')
    setMsg(`Invito ${code} creato.`)
    void share(code)
  }
  const del = (code: string) => {
    if (confirm(`Eliminare l'invito ${code}?`)) void remove(ref(db, `invites/${code}`))
  }
  const rows = Object.entries(invites ?? {}).sort(([, a], [, b]) => (b.createdAt ?? 0) - (a.createdAt ?? 0))

  return (
    <div className="card">
      <h2>Inviti</h2>
      <p className="muted small">Ogni codice vale per una sola registrazione. Chi lo usa ha portafogli tutti suoi: non vede i tuoi dati.</p>
      <div className="inline-pair">
        <input value={note} onChange={e => setNote(e.target.value)} placeholder="Per chi è? (facoltativo)" maxLength={60} aria-label="Nota invito" />
        <button type="button" className="btn btn-primary" onClick={() => void create()}>+ Crea invito</button>
      </div>
      {msg && <p className="small" role="status">{msg}</p>}
      {invites === null ? <p className="muted small">Caricamento…</p> : rows.length === 0 ? <p className="muted small">Nessun invito creato.</p> : (
        <ul className="plain-list">
          {rows.map(([code, i]) => (
            <li key={code}>
              <span>
                <code>{code}</code>{i.note ? ` · ${i.note}` : ''}
                <br />
                <small className={i.usedBy ? 'muted' : 'pos'}>
                  {i.usedBy ? `usato da ${members[i.usedBy]?.email ?? 'utente'}` : 'libero'}
                  {i.createdAt ? ` · creato il ${new Date(i.createdAt).toLocaleDateString('it-IT')}` : ''}
                </small>
              </span>
              {!i.usedBy && (
                <span className="note-actions">
                  <button type="button" className="linklike" onClick={() => void share(code)}>Condividi</button>
                  <button type="button" className="linklike neg" onClick={() => del(code)}>Elimina</button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
