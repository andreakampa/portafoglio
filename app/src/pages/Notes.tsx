import { useState, type FormEvent } from 'react'
import { useNotes, type NoteDraft } from '../data/useNotes'
import { NOTE_KINDS, parseTickers, sortNotes, upcoming, type Note, type NoteKind } from '../domain/notes'
import { TagButton } from '../components/Tag'

const TODAY = new Date().toISOString().slice(0, 10)
const fmtDate = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' })
const kindLabel = (k: NoteKind) => NOTE_KINDS.find(x => x.key === k)!.label

export function Notes() {
  const { notes, error, add, save, del } = useNotes()
  const [filter, setFilter] = useState<NoteKind | 'all'>('all')
  const [editing, setEditing] = useState<Note | 'new' | null>(null)

  if (error) return <section className="page"><h1>Note</h1><div className="card error">{error}</div></section>
  if (!notes) return <section className="page"><h1>Note</h1><div className="card skeleton" style={{ height: 160 }} /></section>

  const next = upcoming(notes, TODAY)
  const list = sortNotes(filter === 'all' ? notes : notes.filter(n => n.kind === filter))

  return (
    <section className="page">
      <header className="page-head row-head">
        <h1>Note</h1>
        <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}>+ Nuova nota</button>
      </header>

      {editing && (
        <NoteForm
          initial={editing === 'new' ? undefined : editing}
          onCancel={() => setEditing(null)}
          onSubmit={async d => {
            if (editing === 'new') await add(d)
            else await save(editing.id, d)
            setEditing(null)
          }}
        />
      )}

      {next.length > 0 && (
        <div className="card">
          <h2>Prossimi 30 giorni</h2>
          <ul className="plain-list">
            {next.map(n => (
              <li key={n.id}>
                <span><b>{n.title}</b>{n.tickers?.length ? <span className="muted"> · {n.tickers.join(', ')}</span> : null}</span>
                <span className={n.date === TODAY ? 'neg' : 'muted'}>{n.date === TODAY ? 'oggi' : fmtDate(n.date!)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="pills" role="tablist" aria-label="Tipo di nota">
        {[{ key: 'all' as const, label: 'Tutte' }, ...NOTE_KINDS].map(k => (
          <button key={k.key} type="button" role="tab" aria-selected={filter === k.key} className={`pill small-pill ${filter === k.key ? 'active' : ''}`} onClick={() => setFilter(k.key)}>
            {k.label}
            <span className="pill-sub">{k.key === 'all' ? notes.length : notes.filter(n => n.kind === k.key).length}</span>
          </button>
        ))}
      </div>

      {list.length === 0 ? (
        <div className="card muted">Nessuna nota{filter === 'all' ? ': scrivi la prima con “Nuova nota”.' : ' di questo tipo.'}</div>
      ) : (
        <ul className="notes">
          {list.map(n => (
            <li key={n.id} className={`card note ${n.done ? 'note-done' : ''}`}>
              <div className="note-head">
                <span className={`kind note-kind-${n.kind}`}>{kindLabel(n.kind)}</span>
                {n.pinned && <span className="badge">fissata</span>}
                {n.date && <span className="muted small note-date">{fmtDate(n.date)}</span>}
              </div>
              <h2>{n.title}</h2>
              {n.body && <p className="note-body">{n.body}</p>}
              {!!n.tickers?.length && <div className="note-tickers">{n.tickers.map(t => <span key={t} className="badge">{t}</span>)}</div>}
              <div className="note-actions">
                <button type="button" className="linklike" onClick={() => void save(n.id, { done: !n.done })}>{n.done ? 'Riapri' : 'Fatto'}</button>
                <button type="button" className="linklike" onClick={() => void save(n.id, { pinned: !n.pinned })}>{n.pinned ? 'Sblocca' : 'Fissa'}</button>
                <TagButton tone="edit" onClick={() => setEditing(n)}>Modifica</TagButton>
                <TagButton tone="delete" onClick={() => { if (confirm(`Eliminare la nota “${n.title}”?`)) void del(n.id) }}>Elimina</TagButton>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function NoteForm({ initial, onSubmit, onCancel }: { initial?: Note; onSubmit: (d: NoteDraft) => Promise<void>; onCancel: () => void }) {
  const [kind, setKind] = useState<NoteKind>(initial?.kind ?? 'idea')
  const [title, setTitle] = useState(initial?.title ?? '')
  const [body, setBody] = useState(initial?.body ?? '')
  const [tickers, setTickers] = useState(initial?.tickers?.join(', ') ?? '')
  const [date, setDate] = useState(initial?.date ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!title.trim()) return setError('Scrivi almeno un titolo.')
    setBusy(true)
    try {
      await onSubmit({
        kind,
        title: title.trim().slice(0, 140),
        body: body.trim().slice(0, 4000),
        tickers: parseTickers(tickers),
        date: date || undefined,
        pinned: initial?.pinned ?? false,
        done: initial?.done ?? false,
      })
    } catch {
      setError('Salvataggio non riuscito: controlla la connessione e riprova.')
      setBusy(false)
    }
  }

  return (
    <form className="card note-form" onSubmit={submit}>
      <h2>{initial ? 'Modifica nota' : 'Nuova nota'}</h2>
      <p className="muted small">{NOTE_KINDS.find(k => k.key === kind)!.hint}</p>
      <div className="pills" role="radiogroup" aria-label="Tipo">
        {NOTE_KINDS.map(k => (
          <button key={k.key} type="button" role="radio" aria-checked={kind === k.key} className={`pill small-pill ${kind === k.key ? 'active' : ''}`} onClick={() => setKind(k.key)}>
            {k.label}
          </button>
        ))}
      </div>
      <label>Titolo<input value={title} onChange={e => setTitle(e.target.value)} maxLength={140} autoFocus /></label>
      <label>Testo<textarea rows={4} value={body} onChange={e => setBody(e.target.value)} maxLength={4000} /></label>
      <div className="form-row">
        <label>Titoli collegati<input value={tickers} onChange={e => setTickers(e.target.value)} placeholder="es. NVDA, RACE.MI" autoCapitalize="characters" /></label>
        <label>{kind === 'evento' ? 'Data evento' : 'Data (facoltativa)'}<input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
      </div>
      <p className="auth-error" role="alert">{error}</p>
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Salvo…' : 'Salva'}</button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Annulla</button>
      </div>
    </form>
  )
}
