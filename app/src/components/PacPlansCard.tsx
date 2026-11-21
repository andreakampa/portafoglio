import { useState } from 'react'
import { usePacPlans } from '../data/usePacPlans'
import type { Computed } from '../data/useComputedPortfolio'
import { symbolOf } from '../domain/engine/valuation'
import { describePlan, parsePlan, WEEKDAYS, type PlanForm } from '../domain/pac'

type Ready = Extract<Computed, { status: 'ready' }>
const today = () => new Date().toISOString().slice(0, 10)
const fmtDate = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('it-IT')

/** Piani di accumulo del portafoglio: le rate maturate si aggiungono da sole (vedi PacRunner). */
export function PacPlansCard({ c }: { c: Ready }) {
  const { plans, save, remove } = usePacPlans()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  const assets = Object.entries(c.portfolio.assets ?? {}).filter(([, a]) => (a.valuta || 'EUR').toUpperCase() === 'EUR')
  const [f, setF] = useState<PlanForm>({ assetId: '', amount: '', kind: 'monthly', weekday: '1', days: '2, 16', from: today() })
  const mine = (plans ?? []).filter(p => p.portfolioId === c.selectedId)
  const set = <K extends keyof PlanForm>(k: K, v: PlanForm[K]) => setF(prev => ({ ...prev, [k]: v }))

  const submit = async () => {
    const { plan, error: err } = parsePlan(f, Date.now().toString(36) + Math.random().toString(36).slice(2, 6), c.selectedId)
    if (!plan) return setError(err ?? 'Dati non validi.')
    setError('')
    try {
      await save(plan)
      setOpen(false)
      setF(prev => ({ ...prev, amount: '' }))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Salvataggio non riuscito.')
    }
  }

  return (
    <div className="card">
      <h2>Piani PAC</h2>
      {mine.length === 0 ? (
        <p className="muted">Nessun piano. Con un piano le rate maturate si aggiungono da sole, al prezzo di chiusura di borsa.</p>
      ) : (
        <ul className="plain-list">
          {mine.map(p => {
            const a = c.portfolio.assets?.[p.assetId]
            return (
              <li key={p.id}>
                <span>
                  <b>{a ? symbolOf(a, p.assetId) : p.assetId}</b>: {describePlan(p)}
                  <br />
                  <small className="muted">dal {fmtDate(p.from)}</small>
                </span>
                <button type="button" className="linklike neg" onClick={() => { if (confirm('Eliminare il piano? Le rate già create restano.')) void remove(p.id) }}>Elimina</button>
              </li>
            )
          })}
        </ul>
      )}
      {!open ? (
        <div className="form-actions"><button type="button" className="btn btn-ghost" onClick={() => setOpen(true)}>+ Nuovo piano</button></div>
      ) : (
        <form className="form" onSubmit={e => { e.preventDefault(); void submit() }}>
          <label>Titolo
            <select value={f.assetId} onChange={e => set('assetId', e.target.value)}>
              <option value="">Scegli…</option>
              {assets.map(([id, a]) => <option key={id} value={id}>{symbolOf(a, id)}</option>)}
            </select>
          </label>
          <label>Importo di ogni rata (€)
            <input inputMode="decimal" value={f.amount} onChange={e => set('amount', e.target.value)} />
          </label>
          <label>Frequenza
            <select value={f.kind} onChange={e => set('kind', e.target.value as PlanForm['kind'])}>
              <option value="monthly">Giorni del mese</option>
              <option value="weekly">Ogni settimana</option>
            </select>
          </label>
          {f.kind === 'monthly' ? (
            <label>Giorni del mese
              <input value={f.days} onChange={e => set('days', e.target.value)} placeholder="2, 16" />
            </label>
          ) : (
            <label>Giorno
              <select value={f.weekday} onChange={e => set('weekday', e.target.value)}>
                {WEEKDAYS.map((w, i) => <option key={w} value={i}>{w}</option>)}
              </select>
            </label>
          )}
          <label>Dal
            <input type="date" value={f.from} onChange={e => set('from', e.target.value)} />
          </label>
          <p className="muted small">Le rate già presenti (anche inserite a mano, entro 3 giorni dalla data prevista) non vengono duplicate. Solo titoli in euro.</p>
          {error && <div className="card error" role="alert">{error}</div>}
          <div className="form-actions">
            <button type="submit" className="btn btn-primary">Salva piano</button>
            <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>Annulla</button>
          </div>
        </form>
      )}
    </div>
  )
}
