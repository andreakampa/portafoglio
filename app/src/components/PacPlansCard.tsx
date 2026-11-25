import { useState } from 'react'
import { usePacPlans } from '../data/usePacPlans'
import type { Computed } from '../data/useComputedPortfolio'
import { symbolOf } from '../domain/engine/valuation'
import { describePlan, formFromPlan, parsePlan, planSummary, scheduledDates, WEEKDAYS, type PacPlan, type PlanForm } from '../domain/pac'
import { eur, money, qty as fmtQty } from '../lib/format'
import { localToday } from '../lib/today'
import { toast } from '../lib/toast'
import { Modal } from './Modal'
import { TrImport } from './TrImport'

type Ready = Extract<Computed, { status: 'ready' }>
const today = () => localToday()
const fmtDate = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('it-IT')
const blank = (): PlanForm => ({ assetId: '', amount: '', kind: 'monthly', weekday: '1', days: '2, 16', from: today(), to: '', commission: '' })

/** Piani di accumulo del portafoglio: le rate maturate si aggiungono da sole (vedi PacRunner). */
export function PacPlansCard({ c }: { c: Ready }) {
  const { plans, save, remove } = usePacPlans()
  /** null = chiuso, 'new' = nuovo piano, altrimenti il piano in modifica. */
  const [editing, setEditing] = useState<'new' | PacPlan | null>(null)
  const [shown, setShown] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState('')
  const assets = Object.entries(c.portfolio.assets ?? {}).sort(([ia, a], [ib, b]) => symbolOf(a, ia).localeCompare(symbolOf(b, ib)))
  const [f, setF] = useState<PlanForm>(blank)
  const mine = (plans ?? []).filter(p => p.portfolioId === c.selectedId)
  // Le rate PAC senza chiave (a mano o dal sito vecchio) vanno al primo piano del titolo.
  const claims = new Set(Object.values(Object.fromEntries([...mine].sort((a, b) => b.from.localeCompare(a.from) || b.id.localeCompare(a.id)).map(p => [p.assetId, p.id]))))
  const set = <K extends keyof PlanForm>(k: K, v: PlanForm[K]) => setF(prev => ({ ...prev, [k]: v }))

  const open = (p: 'new' | PacPlan) => {
    setEditing(p)
    setF(p === 'new' ? blank() : formFromPlan(p))
    setError('')
  }
  const submit = async () => {
    const previous = editing && editing !== 'new' ? editing : undefined
    const id = previous?.id ?? Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
    const { plan, error: err } = parsePlan(f, id, c.selectedId, previous)
    if (!plan) return setError(err ?? 'Dati non validi.')
    setError('')
    try {
      await save(plan)
      toast(previous ? 'Piano modificato' : 'Piano creato')
      setEditing(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Salvataggio non riuscito.')
    }
  }
  // Anteprima delle prossime date, come nel sito vecchio.
  const preview = (() => {
    const { plan } = parsePlan(f, 'anteprima', c.selectedId)
    if (!plan) return []
    const start = plan.from > today() ? plan.from : today()
    const until = new Date(Date.parse(start + 'T12:00:00Z') + 120 * 86400000).toISOString().slice(0, 10)
    return scheduledDates(plan, until).filter(d => d >= start).slice(0, 4)
  })()

  return (
    <div className="card">
      <div className="card-head-row">
        <h2>Piani PAC</h2>
        <button type="button" className="btn btn-ghost btn-small" onClick={() => setImporting(true)}>Importa da Trade Republic</button>
      </div>
      {importing && <Modal title="Importa da Trade Republic" wide onClose={() => setImporting(false)}><TrImport c={c} onClose={() => setImporting(false)} /></Modal>}
      {mine.length === 0 ? (
        <p className="muted">Nessun piano. Con un piano le rate maturate si aggiungono da sole, al prezzo di chiusura di borsa.</p>
      ) : (
        <ul className="plain-list pac-list">
          {mine.map(p => {
            const a = c.portfolio.assets?.[p.assetId]
            const currency = (a?.valuta || 'EUR').toUpperCase()
            const s = planSummary(p, a?.transactions ?? [], today(), currency, claims.has(p.id))
            return (
              <li key={p.id} className="pac-plan">
                <div className="pac-head">
                  <span>
                    <b>{a ? symbolOf(a, p.assetId) : p.assetId}</b>: {describePlan(p)}
                    <br />
                    <small className="muted">
                      dal {fmtDate(p.from)}{p.to ? ` al ${fmtDate(p.to)}` : ''}
                      {p.commission ? ` · commissione ${eur(p.commission)} a rata` : ''}
                      {currency !== 'EUR' ? ` · titolo in ${currency}, rate convertite al cambio del giorno` : ''}
                    </small>
                  </span>
                  <span className="inline-pair">
                    <button type="button" className="linklike" onClick={() => open(p)}>Modifica</button>
                    <button type="button" className="linklike neg" onClick={() => { if (confirm('Eliminare il piano? Le rate già create restano.')) void remove(p.id) }}>Elimina</button>
                  </span>
                </div>
                <div className="pac-stats">
                  <span><small className="muted">Rate</small><b>{s.rates.length}</b></span>
                  <span><small className="muted">Versato</small><b>{eur(s.totalEur)}</b></span>
                  <span><small className="muted">Commissioni</small><b>{eur(s.commissionsEur)}</b></span>
                  <span><small className="muted">Prossima</small><b>{s.nextDate ? fmtDate(s.nextDate) : 'finito'}</b></span>
                </div>
                {s.rates.length > 0 && (
                  <button type="button" className="linklike small" onClick={() => setShown(shown === p.id ? null : p.id)} aria-expanded={shown === p.id}>
                    {shown === p.id ? 'Nascondi le rate' : 'Mostra le rate'}
                  </button>
                )}
                {shown === p.id && (
                  <ul className="plain-list pac-rates">
                    {s.rates.map(r => (
                      <li key={r.date + r.qty}>
                        <span>
                          {fmtDate(r.date)}
                          {r.estimated && <span className="badge badge-warn" title="Prezzo di chiusura di borsa: modifica il movimento per inserire quello vero">da confermare</span>}
                        </span>
                        <span className="num">{fmtQty(r.qty)} × {money(r.price, currency)} <small className="muted">· {eur(r.amountEur)}</small></span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {!editing ? (
        <div className="form-actions"><button type="button" className="btn btn-ghost" onClick={() => open('new')}>+ Nuovo piano</button></div>
      ) : (
        <form className="form" onSubmit={e => { e.preventDefault(); void submit() }}>
          <h3>{editing === 'new' ? 'Nuovo piano' : 'Modifica piano'}</h3>
          <label>Titolo
            <select value={f.assetId} onChange={e => set('assetId', e.target.value)} disabled={editing !== 'new'}>
              <option value="">Scegli…</option>
              {assets.map(([id, a]) => <option key={id} value={id}>{symbolOf(a, id)}{(a.valuta || 'EUR').toUpperCase() !== 'EUR' ? ` (${a.valuta})` : ''}</option>)}
            </select>
          </label>
          <div className="form-row">
            <label>Importo di ogni rata (€)
              <input inputMode="decimal" value={f.amount} onChange={e => set('amount', e.target.value)} />
            </label>
            <label>Commissione per rata (€)
              <input inputMode="decimal" value={f.commission} onChange={e => set('commission', e.target.value)} placeholder="0" />
            </label>
          </div>
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
          <div className="form-row">
            <label>Dal
              <input type="date" value={f.from} onChange={e => set('from', e.target.value)} />
            </label>
            <label>Al (facoltativo)
              <input type="date" value={f.to} min={f.from} onChange={e => set('to', e.target.value)} />
            </label>
          </div>
          {preview.length > 0 && <p className="muted small">Prossime rate: {preview.map(fmtDate).join(', ')}{preview.length === 4 ? '…' : ''}</p>}
          <p className="muted small">
            Le rate già presenti (anche inserite a mano, entro 3 giorni dalla data prevista) non vengono duplicate. Una rata eliminata dai movimenti non torna.
            Per i titoli non in euro l'importo si converte al cambio Banca d'Italia del giorno.
          </p>
          {error && <div className="card error" role="alert">{error}</div>}
          <div className="form-actions">
            <button type="submit" className="btn btn-primary">Salva piano</button>
            <button type="button" className="btn btn-ghost" onClick={() => setEditing(null)}>Annulla</button>
          </div>
        </form>
      )}
    </div>
  )
}
