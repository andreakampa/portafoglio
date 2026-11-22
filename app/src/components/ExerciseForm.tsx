import { ref, update } from 'firebase/database'
import { useState, type FormEvent } from 'react'
import { useUser } from '../auth/context'
import type { Computed } from '../data/useComputedPortfolio'
import type { RawAsset, RawTx } from '../domain/engine/types'
import { symbolOf } from '../domain/engine/valuation'
import { addToList, assetKey, buildExercise, optionKind, optionStrike } from '../domain/txEdit'
import { db } from '../lib/firebase'
import { money, qty as fmtQty } from '../lib/format'

type Ready = Extract<Computed, { status: 'ready' }>
type Asset = RawAsset & { isin?: string; commDefault?: number }
const today = () => new Date().toISOString().slice(0, 10)
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
const clean = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T

/** Sottostante dal ticker OCC (le lettere prima della data). */
const underlyingOf = (ticker: string) => /^([A-Z.]+)\d{6}[CP]\d{8}$/.exec(ticker.toUpperCase())?.[1] ?? ''

/**
 * Opzione esercitata o assegnata, inserita a mano: chiude l'opzione e registra l'acquisto o la vendita delle azioni
 * al prezzo d'esercizio. Il premio passa da solo nel costo o nel ricavo delle azioni (regola fiscale).
 */
export function ExerciseFormCard({ c, onClose }: { c: Ready; onClose: () => void }) {
  const { user } = useUser()
  const assets = (c.portfolio.assets ?? {}) as Record<string, Asset>
  const open = Object.entries(assets)
    .filter(([id, a]) => a.tipoAsset === 'option' && Math.abs(c.result.positions[id]?.qty ?? 0) > 1e-9)
    .map(([id, a]) => ({ id, a, ticker: symbolOf(a, id), held: c.result.positions[id]!.qty }))
  const [optId, setOptId] = useState(open[0]?.id ?? '')
  const sel = open.find(o => o.id === optId)
  const kind = optionKind(sel?.ticker)
  const under = sel ? underlyingOf(sel.ticker) : ''
  const stockId = Object.entries(assets).find(([, a]) => a.tipoAsset !== 'option' && (a.ticker ?? '').toUpperCase().split('.')[0] === under)?.[0]
  const [date, setDate] = useState(today())
  const [qty, setQty] = useState(sel ? String(Math.abs(sel.held)) : '')
  const [strike, setStrike] = useState(sel ? String(optionStrike(sel.ticker) ?? '') : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const pick = (id: string) => {
    const o = open.find(x => x.id === id)
    setOptId(id)
    setQty(o ? String(Math.abs(o.held)) : '')
    setStrike(o ? String(optionStrike(o.ticker) ?? '') : '')
  }

  if (!open.length) {
    return (
      <div className="card">
        <h2>Esercizio o assegnazione</h2>
        <p className="muted">In questo portafoglio non ci sono opzioni aperte.</p>
        <button type="button" className="btn btn-ghost" onClick={onClose}>Chiudi</button>
      </div>
    )
  }

  const long = (sel?.held ?? 0) > 0
  const buys = kind ? (kind === 'call') === long : null
  const what = `${long ? 'Eserciti' : 'Vieni assegnato su'} ${fmtQty(Math.abs(sel?.held ?? 0) / 100)} ${kind ?? 'opzione'}: ${buys ? 'compri' : 'vendi'} le azioni ${under || 'sottostanti'} al prezzo d'esercizio.`

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!sel || !kind || !under) return setError('Non riconosco l’opzione: il ticker deve essere nel formato OCC (es. BMEA280121C00001500).')
    const q = Number(qty.replace(',', '.'))
    if (!(q > 0) || q > Math.abs(sel.held) + 1e-9) return setError(`La quantità va da 1 a ${Math.abs(sel.held)} (contratti × 100).`)
    if (!(Number(strike.replace(',', '.')) > 0)) return setError('Scrivi il prezzo d’esercizio.')
    if (date > today()) return setError('La data non può essere nel futuro.')
    setBusy(true)
    try {
      const { option, stock } = buildExercise(kind, sel.held, { date, qty, strike }, newId)
      const sid = stockId ?? assetKey(under)
      const stockAsset: Asset = assets[sid] ?? { nome: under, ticker: under, valuta: sel.a.valuta || 'USD', tipoAsset: 'stock', commDefault: 0, transactions: [] }
      const root = `users/${user.uid}/portfolio_state/portfolios/${c.selectedId}/assets`
      await update(ref(db, root), clean({
        [`${optId}/transactions`]: addToList(sel.a.transactions as RawTx[], option),
        [sid]: { ...stockAsset, transactions: addToList(stockAsset.transactions, stock) },
      }))
      onClose()
    } catch {
      setError('Salvataggio non riuscito: controlla la connessione e riprova.')
      setBusy(false)
    }
  }

  return (
    <form className="card note-form" onSubmit={submit}>
      <h2>Esercizio o assegnazione</h2>
      <label>Opzione
        <select value={optId} onChange={e => pick(e.target.value)}>
          {open.map(o => <option key={o.id} value={o.id}>{o.a.nome || o.ticker} ({o.held > 0 ? 'comprata' : 'venduta'}, {fmtQty(Math.abs(o.held) / 100)} contratti)</option>)}
        </select>
      </label>
      <p className="small">{what}</p>
      <div className="form-row">
        <label>Data<input type="date" value={date} max={today()} onChange={e => setDate(e.target.value)} /></label>
        <label>Quantità (azioni)<input inputMode="decimal" value={qty} onChange={e => setQty(e.target.value)} /></label>
      </div>
      <label>Prezzo d’esercizio ({(sel?.a.valuta || 'USD').toUpperCase()})<input inputMode="decimal" value={strike} onChange={e => setStrike(e.target.value)} /></label>
      <p className="muted small">
        L’opzione si chiude senza plus o minus: il premio {long ? 'pagato' : 'incassato'} entra nel {buys ? 'costo' : 'ricavo'} delle azioni, come prevede la regola fiscale.
        {!stockId && under && ` Il titolo ${under} non è nel portafoglio: viene creato.`}
        {sel && strike && ` Controvalore: ${money(Number(qty.replace(',', '.')) * Number(strike.replace(',', '.')), (sel.a.valuta || 'USD').toUpperCase())}.`}
      </p>
      <p className="auth-error" role="alert">{error}</p>
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Salvo…' : 'Registra'}</button>
        <button type="button" className="btn btn-ghost" onClick={onClose}>Annulla</button>
      </div>
    </form>
  )
}
