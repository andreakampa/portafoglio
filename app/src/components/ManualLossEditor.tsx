// Minus inserite a mano (come nel cassetto fiscale del sito vecchio): modulo per aggiungerne una o correggerla.
import { useState, type FormEvent } from 'react'
import { usePortfolioEdit } from '../data/usePortfolioEdit'
import { buildManualLoss, formOf, removeManualLoss, replaceManualLoss, validateManualLoss, type ManualLossForm, type StoredManualLoss } from '../domain/manualLosses'
import { eur } from '../lib/format'
import { localToday } from '../lib/today'
import { toast } from '../lib/toast'

const fmtDate = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('it-IT')
const empty = (): ManualLossForm => ({ date: localToday(), amount: '', title: '', categoria: 'strumenti' })

/** Modulo per una minus a mano: nuova (`editing` assente) o da correggere (`editing` = posizione e voce vista). */
export function ManualLossEditor({ pid, editing, onDone }: { pid: string; editing?: { index: number; loss: StoredManualLoss }; onDone: () => void }) {
  const edit = usePortfolioEdit()
  const [f, setF] = useState<ManualLossForm>(() => (editing ? formOf(editing.loss) : empty()))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function save(e: FormEvent) {
    e.preventDefault()
    const problem = validateManualLoss(f, localToday())
    if (problem) return setError(problem)
    setBusy(true)
    try {
      const loss = buildManualLoss(f)
      await edit.changeManualLosses(pid, cur => (editing ? replaceManualLoss(cur, editing.index, editing.loss, loss) : [...cur, loss]))
      toast(editing ? 'Minus modificata' : 'Minus aggiunta')
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Salvataggio non riuscito.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="note-form" onSubmit={save}>
      {!editing && <p className="muted small">Minus realizzate altrove (altra banca, fondo chiuso…): entrano nel cassetto dalla loro data e si usano per 4 anni.</p>}
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
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Salvo…' : editing ? 'Salva' : 'Aggiungi'}</button>
        <button type="button" className="btn btn-ghost" onClick={onDone}>Annulla</button>
      </div>
    </form>
  )
}

/** Elimina una minus a mano, con conferma. Torna false se l'utente annulla. */
export async function removeManualLossAsk(edit: ReturnType<typeof usePortfolioEdit>, pid: string, index: number, loss: StoredManualLoss): Promise<boolean> {
  if (!confirm(`Eliminare la minus di ${eur(Math.abs(Number(loss.amount)))} del ${fmtDate(loss.date)}?`)) return false
  await edit.changeManualLosses(pid, cur => removeManualLoss(cur, index, loss))
  toast('Minus eliminata')
  return true
}
