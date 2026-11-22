import { useEffect, useRef, useState } from 'react'
import { useUser } from '../auth/context'
import { useWatchlist } from '../data/useWatchlist'
import { parseWatchlistCsv, type WatchItem } from '../domain/watchlist'
import { pct } from '../lib/format'
import { loadQuotes, type Quote } from '../lib/prices'
import { disablePush, enablePush, pushState, type PushState } from '../lib/push'

const num = (s: string) => {
  const v = Number(s.trim().replace(',', '.'))
  return s.trim() && Number.isFinite(v) && v > 0 ? v : undefined
}
const price = (v: number, cur?: string) => v.toLocaleString('it-IT', { maximumFractionDigits: v < 10 ? 4 : 2 }) + (cur ? ` ${cur}` : '')

/** Titoli da seguire con soglie di prezzo: avviso nell'app e notifica sul telefono (Worker ogni 15 minuti). */
export function Watchlist() {
  const { user } = useUser()
  const w = useWatchlist()
  const [quotes, setQuotes] = useState<Record<string, Quote>>({})
  const [symbol, setSymbol] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const file = useRef<HTMLInputElement>(null)
  const symbols = (w.items ?? []).map(i => i.symbol).join(',')

  useEffect(() => {
    if (!symbols) return
    let alive = true
    const load = () => loadQuotes(symbols.split(',')).then(q => alive && setQuotes(prev => ({ ...prev, ...q })))
    void load()
    const t = setInterval(load, 5 * 60 * 1000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [symbols])

  const add = async () => {
    const list = symbol.split(/[\s,;]+/).filter(Boolean).map(s => ({ symbol: s.toUpperCase() }))
    if (!list.length) return
    const n = await w.add(list, w.items ?? [])
    setSymbol('')
    setMsg({ ok: true, text: n ? `${n} ${n === 1 ? 'titolo aggiunto' : 'titoli aggiunti'}.` : 'Già presente.' })
  }

  const importCsv = async (f: File | undefined) => {
    if (!f) return
    try {
      const list = parseWatchlistCsv(await f.text())
      if (!list.length) throw new Error('Nel file non ho trovato simboli.')
      const n = await w.add(list, w.items ?? [])
      setMsg({ ok: true, text: `Importati ${n} titoli nuovi su ${list.length} (gli altri c'erano già). Controlla i simboli: per Yahoo i titoli europei hanno il suffisso di borsa, es. RACE.MI.` })
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) })
    } finally {
      if (file.current) file.current.value = ''
    }
  }

  return (
    <section className="page">
      <header className="page-head">
        <h1>Watchlist</h1>
        <p className="muted small">Titoli da seguire e soglie di prezzo. Gli avvisi arrivano come notifica sui dispositivi dove le attivi (controllo ogni 15 minuti).</p>
      </header>

      <PushCard uid={user.uid} />

      <form className="card note-form" onSubmit={e => { e.preventDefault(); void add() }}>
        <h2>Aggiungi</h2>
        <div className="inline-pair">
          <input value={symbol} onChange={e => setSymbol(e.target.value)} placeholder="Simbolo Yahoo, es. NVDA o RACE.MI (anche più di uno)" autoCapitalize="characters" aria-label="Simbolo" />
          <button type="submit" className="btn btn-primary">Aggiungi</button>
        </div>
        <input ref={file} type="file" accept=".csv,.txt,text/csv,text/plain" hidden onChange={e => void importCsv(e.target.files?.[0])} />
        <button type="button" className="btn btn-ghost" onClick={() => file.current?.click()}>Importa da IBKR (CSV)</button>
        <p className="muted small">IBKR: dalla watchlist di TWS o del Portale usa «Esporta» in CSV. Va bene anche un semplice elenco di simboli, uno per riga.</p>
        {msg && <p className={msg.ok ? 'small' : 'neg small'} role="status">{msg.text}</p>}
      </form>

      {w.items === null ? (
        <div className="card skeleton" style={{ height: 160 }} />
      ) : w.items.length === 0 ? (
        <div className="card muted">La watchlist è vuota.</div>
      ) : (
        <ul className="mov-list watch-list">
          {w.items.map(it => (
            <WatchRow key={it.id} it={it} q={quotes[it.symbol]} editing={editing === it.id} onEdit={() => setEditing(editing === it.id ? null : it.id)} save={w.save} remove={w.remove} />
          ))}
        </ul>
      )}
    </section>
  )
}

function WatchRow({ it, q, editing, onEdit, save, remove }: {
  it: WatchItem
  q?: Quote
  editing: boolean
  onEdit: () => void
  save: ReturnType<typeof useWatchlist>['save']
  remove: ReturnType<typeof useWatchlist>['remove']
}) {
  const [above, setAbove] = useState(it.above != null ? String(it.above) : '')
  const [below, setBelow] = useState(it.below != null ? String(it.below) : '')
  const [note, setNote] = useState(it.note ?? '')
  const ch = q?.previousClose ? ((q.price - q.previousClose) / q.previousClose) * 100 : null
  const hitAbove = q && it.above != null && q.price >= it.above
  const hitBelow = q && it.below != null && q.price <= it.below

  return (
    <li className="card mov-item">
      <div className="mov-head">
        <b>{it.symbol}</b>
        {it.name && <span className="muted small">{it.name}</span>}
        {(hitAbove || hitBelow) && <span className="badge status-pill status-critical">▲ soglia raggiunta</span>}
      </div>
      <div className="mov-body">
        <span>{q ? price(q.price, q.currency) : 'prezzo non disponibile'}</span>
        {ch !== null && <b className={ch >= 0 ? 'pos' : 'neg'}>{pct(ch)}</b>}
      </div>
      <div className="muted small">
        {it.above != null && <>sopra {price(it.above)}{hitAbove ? ' ✓' : ''} · </>}
        {it.below != null && <>sotto {price(it.below)}{hitBelow ? ' ✓' : ''} · </>}
        {it.above == null && it.below == null && 'nessuna soglia · '}
        {it.note}
      </div>
      <span className="note-actions">
        <button type="button" className="linklike" onClick={onEdit}>{editing ? 'Chiudi' : 'Soglie e nota'}</button>
        <button type="button" className="linklike neg" onClick={() => { if (confirm(`Togliere ${it.symbol} dalla watchlist?`)) void remove(it.id) }}>Togli</button>
      </span>
      {editing && (
        <form className="note-form" onSubmit={e => { e.preventDefault(); void save(it.id, { above: num(above), below: num(below), note }).then(onEdit) }}>
          <div className="form-row">
            <label>Avvisami sopra<input inputMode="decimal" value={above} onChange={e => setAbove(e.target.value)} placeholder={q ? price(q.price * 1.1) : ''} /></label>
            <label>Avvisami sotto<input inputMode="decimal" value={below} onChange={e => setBelow(e.target.value)} placeholder={q ? price(q.price * 0.9) : ''} /></label>
          </div>
          <label>Nota<input value={note} onChange={e => setNote(e.target.value)} /></label>
          <div className="form-actions"><button type="submit" className="btn btn-primary">Salva</button></div>
        </form>
      )}
    </li>
  )
}

function PushCard({ uid }: { uid: string }) {
  const [state, setState] = useState<PushState | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    void pushState().then(setState)
  }, [])
  const toggle = async () => {
    setErr('')
    try {
      if (state === 'on') await disablePush(uid)
      else await enablePush(uid)
      setState(await pushState())
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }
  if (state === null) return null
  return (
    <div className="card">
      <h2>Notifiche su questo dispositivo</h2>
      {state === 'on' && <p className="small pos">Attive: gli avvisi arrivano qui anche ad app chiusa.</p>}
      {state === 'off' && <p className="small">Spente su questo dispositivo.</p>}
      {state === 'denied' && <p className="small neg">Bloccate nelle impostazioni del browser per questo sito: vanno riattivate da lì.</p>}
      {state === 'needs-install' && <p className="small">Su iPhone le notifiche funzionano solo con l’app installata: Condividi → «Aggiungi alla schermata Home», poi apri l’app da lì.</p>}
      {state === 'unsupported' && <p className="small muted">Questo browser non supporta le notifiche push.</p>}
      {(state === 'on' || state === 'off') && (
        <button type="button" className={`btn ${state === 'on' ? 'btn-ghost' : 'btn-primary'}`} onClick={() => void toggle()}>
          {state === 'on' ? 'Spegni le notifiche' : 'Attiva le notifiche'}
        </button>
      )}
      {err && <p className="neg small">{err}</p>}
    </div>
  )
}
