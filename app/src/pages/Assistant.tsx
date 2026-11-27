import { useState, type FormEvent } from 'react'
import { Markdown } from '../components/Markdown'
import { PortfolioPicker } from '../components/PortfolioPicker'
import { useComputedPortfolio } from '../data/useComputedPortfolio'
import { buildAiContext } from '../domain/aiContext'
import { PROXY } from '../lib/proxy'
import { localToday } from '../lib/today'

// Stessa chiave del sito attuale (stesso dominio): chi l'ha già inserita là non la deve rimettere.
const KEY_STORAGE = 'gemini_api_key'
const TODAY = localToday()
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
  troppe_richieste: 'Troppe domande in poco tempo: aspetta un minuto e riprova.',
  quota_esaurita: 'Hai finito le richieste gratuite di Gemini per ora: riprova più tardi.',
  gemini_non_disponibile: 'Gemini non risponde in questo momento: riprova tra poco.',
  risposta_vuota: 'Gemini ha mandato una risposta vuota: riprova.',
  risposta_troppo_lunga: 'Gemini si è fermato prima di scrivere la risposta: riprova o fai una domanda più mirata.',
  risposta_bloccata: 'Gemini non ha voluto rispondere a questa domanda: prova a riformularla.',
}

const TRUNCATED_NOTE = '\n\n*(Risposta interrotta perché troppo lunga: chiedi «continua» o fai una domanda più mirata.)*'

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

const ANALYSIS_PROMPT =
  'Analizza il portafoglio: diversificazione e concentrazione, posizioni con i risultati migliori e peggiori, situazione fiscale (minus da usare e scadenze), rischi principali. Chiudi con 3 spunti concreti. Usa titoli brevi ed elenchi.'
/** Ultima analisi per portafoglio, su questo dispositivo: si rilegge senza rifare la richiesta. */
const analysisKey = (pid: string) => `ptpro_v2_ai_analysis_${pid}`
const readAnalysis = (pid: string): { date: string; text: string } | null => {
  try {
    return JSON.parse(localStorage.getItem(analysisKey(pid)) || 'null') as { date: string; text: string } | null
  } catch {
    return null
  }
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
  // Privacy: di base a Gemini vanno solo pesi e percentuali. Gli importi solo se l'utente lo attiva (vale fino a quando lascia la pagina).
  const [amounts, setAmounts] = useState(false)

  const saveKey = (k: string) => {
    try {
      if (k) localStorage.setItem(KEY_STORAGE, k)
      else localStorage.removeItem(KEY_STORAGE)
    } catch {
      /* storage non disponibile: vale solo per questa sessione */
    }
    setKey(k)
  }

  async function ask(text: string, saveAs?: string) {
    if (c.status !== 'ready' || !text.trim() || busy) return
    setBusy(true)
    setError('')
    const history = chat.slice(-6)
    setChat(m => [...m, { role: 'user', text }])
    setQuestion('')
    try {
      const context = buildAiContext({ portfolio: c.portfolio, result: c.result, rows: c.rows, totals: c.totals, today: TODAY, amounts })
      const r = await fetch(`${PROXY}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Gemini-Key': key },
        body: JSON.stringify({ question: text, context, history }),
        signal: AbortSignal.timeout(60000),
      })
      const j = (await r.json()) as { answer?: string; error?: string; truncated?: boolean }
      if (!r.ok || !j.answer) throw new Error(ERRORS[j.error ?? ''] ?? 'Risposta non arrivata: riprova.')
      const answer = j.answer + (j.truncated ? TRUNCATED_NOTE : '')
      setChat(m => [...m, { role: 'model', text: answer }])
      // Un'analisi interrotta non si salva: la prossima volta "Analizza portafoglio" la rifà intera.
      if (saveAs && !j.truncated) {
        try {
          localStorage.setItem(analysisKey(saveAs), JSON.stringify({ date: TODAY, text: j.answer }))
        } catch {
          /* storage non disponibile */
        }
      }
    } catch (e) {
      setError(e instanceof Error && e.name !== 'TimeoutError' ? e.message : 'Gemini ci mette troppo: riprova.')
      setChat(m => m.slice(0, -1))
      setQuestion(text)
    } finally {
      setBusy(false)
    }
  }

  const pid = c.status === 'ready' ? c.selectedId : ''
  const last = pid ? readAnalysis(pid) : null
  const analyze = (fresh: boolean) => {
    if (!fresh && last) {
      setChat(m => [...m, { role: 'user', text: 'Analizza portafoglio' }, { role: 'model', text: `*Analisi del ${new Date(last.date + 'T12:00:00').toLocaleDateString('it-IT')}*\n\n${last.text}` }])
      return
    }
    if (fresh && last && !confirm('Rifare l’analisi? Usa una richiesta Gemini.')) return
    void ask(ANALYSIS_PROMPT, pid)
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
        <p className="muted small">Fai domande sul portafoglio scelto: l’assistente vede titoli, pesi, risultati in percentuale, situazione fiscale dell’anno e ultimi movimenti (mai il nome del conto né i tuoi dati personali). Non è consulenza finanziaria.</p>
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
            <label className="check small" style={{ alignItems: 'flex-start' }}>
              <input type="checkbox" checked={amounts} onChange={e => setAmounts(e.target.checked)} />
              <span>
                Manda anche gli importi (euro, quantità, prezzi e PMC)
                <br />
                <span className="muted">{amounts ? 'Gemini riceve anche i valori: risposte più precise su tasse e cifre.' : 'Ora Gemini riceve solo titoli, pesi e percentuali, come nel sito vecchio.'}</span>
              </span>
            </label>
            <div className="form-actions">
              <button type="button" className="btn btn-primary" onClick={() => analyze(false)} disabled={busy || c.status !== 'ready'}>
                Analizza portafoglio
              </button>
              {last && (
                <button type="button" className="btn btn-ghost" onClick={() => analyze(true)} disabled={busy || c.status !== 'ready'}>
                  Rifai l'analisi
                </button>
              )}
              {last && <span className="muted small">ultima del {new Date(last.date + 'T12:00:00').toLocaleDateString('it-IT')}</span>}
            </div>
            {chat.length === 0 && (
              <div className="chat-suggestions">
                {SUGGESTIONS.map(s => <button key={s} type="button" className="pill small-pill" onClick={() => void ask(s)} disabled={busy || c.status !== 'ready'}>{s}</button>)}
              </div>
            )}
            {chat.map((m, i) => (
              <div key={i} className={`chat-msg chat-${m.role}`}>{m.role === 'model' ? <Markdown text={m.text} /> : m.text}</div>
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
