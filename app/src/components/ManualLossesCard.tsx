// Minus inserite a mano (come nel cassetto fiscale del sito vecchio): elenco, aggiunta, eliminazione.
import { useState, type FormEvent } from 'react'
import { usePortfolioEdit } from '../data/usePortfolioEdit'
import { buildManualLoss, removeManualLoss, validateManualLoss, type ManualLossForm, type StoredManualLoss } from '../domain/manualLosses'
import { eur } from '../lib/format'
import { localToday } from '../lib/today'
import { toast } from '../lib/toast'

const fmtDate = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('it-IT')
const empty = (): ManualLossForm => ({ date: localToday(), amount: '', title: '', categoria: 'strumenti' })

export function ManualLossesCard({ pid, list }: { pid: string; list: StoredManualLoss[] }) {
  const edit = usePortfolioEdit()
  const [open, setOpen] = useState(false)
  const [f, setF] = useState<ManualLossForm>(empty)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function add(e: FormEvent) {
    e.preventDefault()
    const problem = validateManualLoss(f, localToday())
    if (problem) return setError(problem)
    setBusy(true)
    try {
      const loss = buildManualLoss(f)
      await edit.changeManualLosses(pid, cur => [...cur, loss])
      toast('Minus aggiunta')
      setF(empty())
      setOpen(false)
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Salvataggio non riuscito.')
    } finally {
      setBusy(false)
    }
  }

  async function remove(i: number, m: StoredManualLoss) {
    if (!confirm(`Eliminare la minus di ${eur(Number(m.amount))} del ${fmtDate(m.date)}?`)) return
    try {
      await edit.changeManualLosses(pid, cur => removeManualLoss(cur, i, m))
      toast('Minus eliminata')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Eliminazione non riuscita.')
    }
  }

  return (
    <div className="card">
      <h2>Minus inserite a mano</h2>
      <p className="muted small">Minus realizzate altrove (altra banca, fondo chiuso…): entrano nel cassetto dalla loro data e si usano per 4 anni.</p>
      {list.length > 0 && (
        <ul className="plain-list">
          {list.map((m, i) => (
            <li key={`${i}-${m.date}`}>
              <span>
                {m.title || 'Minus inserita a mano'}
                <br />
                <small className="muted">{fmtDate(m.date)}{m.categoria === 'crypto' ? ' · crypto' : ''}</small>
              </span>
              <span className="inline-pair">
                <b className="neg">{eur(-Math.abs(Number(m.amount)))}</b>
                <button type="button" className="linklike neg" onClick={() => void remove(i, m)} aria-label={`Elimina la minus ${m.title ?? ''}`}>Elimina</button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {open ? (
        <form className="note-form" onSubmit={add}>
          <div className="form-row">
            <label>Data<input type="date" value={f.date} max={localToday()} onChange={e => setF({ ...f, date: e.target.value })} /></label>
            <label>Importo (€)<input inputMode="decimal" value={f.amount} onChange={e => setF({ ...f, amount: e.target.value })} placeholder="es. 204,81" /></label>
          </div>
          <label>Da dove viene<input value={f.title} onChange={e => setF({ ...f, title: e.target.value })} placeholder="es. fondo MBB chiuso in perdita" /></label>
          <label>Tipo
            <select value={f.categoria} onChange={e => setF({ ...f, categoria: e.target.value as ManualLossForm['categoria'] })}>
              <option value="strumenti">Azioni, ETF, obbligazioni, fondi</option>
              <option value="crypto">Crypto</option>
            </select>
          </label>
          <p className="auth-error" role="alert">{error}</p>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Salvo…' : 'Aggiungi'}</button>
            <button type="button" className="btn btn-ghost" onClick={() => { setOpen(false); setError('') }}>Annulla</button>
          </div>
        </form>
      ) : (
        <>
          {error && <p className="auth-error" role="alert">{error}</p>}
          <button type="button" className="btn btn-ghost" onClick={() => setOpen(true)}>+ Aggiungi una minus</button>
        </>
      )}
    </div>
  )
}
