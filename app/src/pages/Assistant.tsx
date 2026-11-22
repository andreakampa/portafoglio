import { useState, type FormEvent } from 'react'
import { PortfolioPicker } from '../components/PortfolioPicker'
import { useComputedPortfolio } from '../data/useComputedPortfolio'
import { buildAiContext } from '../domain/aiContext'
import { PROXY } from '../lib/proxy'

// Stessa chiave del sito attuale (stesso dominio): chi l'ha già inserita là non la deve rimettere.
const KEY_STORAGE = 'gemini_api_key'
const TODAY = new Date().toISOString().slice(0, 10)
const readKey = () => {
  try {
    return localStorage.getItem(KEY_STORAGE) ?? ''
  } catch {
    return ''
  }
}

const ERRORS: Record<string, string> = {
  chiave_mancante: 'Serve la tua chiave Gemini (vedi sotto).',
  chiave_non_valida: 'La chiave Gemini non è valida: controllala o creane una nuova.',
  quota_esaurita: 'Hai finito le richieste gratuite di Gemini per ora: riprova più tardi.',
  gemini_non_disponibile: 'Gemini non risponde in questo momento: riprova tra poco.',
}

const SUGGESTIONS = [
  'Quali posizioni pesano di più e quanto sono concentrato?',
  'Quanto pagherei di tasse se vendessi i titoli in guadagno?',
  'Quali minus posso ancora usare e quando scadono?',
  'Riassumi i movimenti dell’ultimo mese.',
]

interface Msg {
  role: 'user' | 'model'
  text: string
}

/** Assistente AI (Gemini, con la chiave personale dell'utente) che risponde sui dati del portafoglio scelto. */
export function Assistant() {
  const c = useComputedPortfolio()
  const [key, setKey] = useState(readKey)
  const [keyInput, setKeyInput] = useState('')
  const [chat, setChat] = useState<Msg[]>([])
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const saveKey = (k: string) => {
    try {
      if (k) localStorage.setItem(KEY_STORAGE, k)
      else localStorage.removeItem(KEY_STORAGE)
    } catch {
      /* storage non disponibile: vale solo per questa sessione */
    }
    setKey(k)
  }

  async function ask(text: string) {
    if (c.status !== 'ready' || !text.trim() || busy) return
    setBusy(true)
    setError('')
    const history = chat.slice(-6)
    setChat(m => [...m, { role: 'user', text }])
    setQuestion('')
    try {
      const context = buildAiContext({ portfolio: c.portfolio, result: c.result, rows: c.rows, totals: c.totals, today: TODAY })
      const r = await fetch(`${PROXY}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Gemini-Key': key },
        body: JSON.stringify({ question: text, context, history }),
        signal: AbortSignal.timeout(60000),
      })
      const j = (await r.json()) as { answer?: string; error?: string }
      if (!r.ok || !j.answer) throw new Error(ERRORS[j.error ?? ''] ?? 'Risposta non arrivata: riprova.')
      setChat(m => [...m, { role: 'model', text: j.answer! }])
    } catch (e) {
      setError(e instanceof Error && e.name !== 'TimeoutError' ? e.message : 'Gemini ci mette troppo: riprova.')
      setChat(m => m.slice(0, -1))
      setQuestion(text)
    } finally {
      setBusy(false)
    }
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    void ask(question)
  }

  return (
    <section className="page">
      <header className="page-head">
        <h1>Assistente</h1>
        {c.status === 'ready' && <PortfolioPicker options={c.options} selectedId={c.selectedId} onSelect={id => { c.select(id); setChat([]) }} />}
        <p className="muted small">Fai domande sul portafoglio scelto: l’assistente vede posizioni, risultati, situazione fiscale dell’anno e ultimi movimenti (non il nome del conto né i tuoi dati personali). Non è consulenza finanziaria.</p>
      </header>

      {!key ? (
        <form className="card note-form" onSubmit={e => { e.preventDefault(); if (keyInput.trim()) saveKey(keyInput.trim()) }}>
          <h2>Serve la tua chiave Gemini</h2>
          <p className="small">
            È gratuita: vai su <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">Google AI Studio</a>, accedi con Google,
            «Create API key», copiala e incollala qui. Resta solo su questo dispositivo e passa da Gemini solo quando fai una domanda.
          </p>
          <input value={keyInput} onChange={e => setKeyInput(e.target.value)} placeholder="AIza…" autoComplete="off" spellCheck={false} aria-label="Chiave Gemini" />
          <div className="form-actions"><button type="submit" className="btn btn-primary">Salva chiave</button></div>
        </form>
      ) : (
        <>
          <div className="card chat">
            {chat.length === 0 && (
              <div className="chat-suggestions">
                {SUGGESTIONS.map(s => <button key={s} type="button" className="pill small-pill" onClick={() => void ask(s)} disabled={busy || c.status !== 'ready'}>{s}</button>)}
              </div>
            )}
            {chat.map((m, i) => (
              <div key={i} className={`chat-msg chat-${m.role}`}>{m.text}</div>
            ))}
            {busy && <div className="chat-msg chat-model muted">Sto pensando…</div>}
            {error && <p className="neg small" role="alert">{error}</p>}
          </div>
          <form className="card note-form chat-input" onSubmit={submit}>
            <textarea value={question} onChange={e => setQuestion(e.target.value)} rows={2} maxLength={2000} placeholder="Scrivi una domanda…" aria-label="Domanda"
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void ask(question) } }} />
            <div className="form-actions">
              <button type="submit" className="btn btn-primary" disabled={busy || !question.trim() || c.status !== 'ready'}>Chiedi</button>
              {chat.length > 0 && <button type="button" className="btn btn-ghost" onClick={() => setChat([])}>Nuova conversazione</button>}
              <button type="button" className="linklike muted small" onClick={() => { if (confirm('Togliere la chiave Gemini da questo dispositivo?')) saveKey('') }}>Togli chiave</button>
            </div>
          </form>
        </>
      )}
    </section>
  )
}
