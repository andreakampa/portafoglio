import { useState, type FormEvent } from 'react'
import type { Computed } from '../data/useComputedPortfolio'
import { usePortfolioEdit } from '../data/usePortfolioEdit'
import { usePortfolioState } from '../data/usePortfolioState'
import type { RawAsset } from '../domain/engine/types'
import type { Movement } from '../domain/engine/movements'
import { symbolOf } from '../domain/engine/valuation'
import {
  ASSET_TYPES, assetKey, buildAsset, buildTx, EDITABLE_LABEL, formFromTx, validateNewAsset, validateTransfer, validateTx,
  type EditableType, type NewAssetForm, type TxForm,
} from '../domain/txEdit'
import { money, qty as fmtQty } from '../lib/format'

type Ready = Extract<Computed, { status: 'ready' }>
const today = () => new Date().toISOString().slice(0, 10)
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
const NEW = '__new__'

/** Nuovo movimento (acquisto, vendita, short, PAC) o modifica di uno esistente. */
export function MovementForm({ c, editing, onClose }: { c: Ready; editing?: Movement; onClose: () => void }) {
  const edit = usePortfolioEdit()
  const assets = Object.entries(c.portfolio.assets ?? {})
    .map(([id, a]) => ({ id, label: symbolOf(a, id), currency: (a.valuta || 'EUR').toUpperCase() }))
    .sort((a, b) => a.label.localeCompare(b.label))

  const [assetId, setAssetId] = useState(editing?.assetId ?? assets[0]?.id ?? NEW)
  const [na, setNa] = useState<NewAssetForm>({ ticker: '', nome: '', valuta: 'EUR', tipoAsset: 'stock', isin: '' })
  const isNew = assetId === NEW
  const currency = isNew ? na.valuta.trim().toUpperCase() || 'EUR' : assets.find(a => a.id === assetId)?.currency ?? 'EUR'

  const prev = editing ? c.portfolio.assets?.[editing.assetId]?.transactions?.[editing.index] : undefined
  const [f, setF] = useState<TxForm>(
    prev && editing
      ? formFromTx(prev, currency)
      : { type: 'buy', date: today(), qty: '', price: '', commission: '', commissionCurrency: 'EUR', pac: false },
  )
  const set = <K extends keyof TxForm>(k: K, v: TxForm[K]) => setF(x => ({ ...x, [k]: v }))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const gross = Number(f.qty.replace(',', '.')) * Number(f.price.replace(',', '.'))

  async function submit(e: FormEvent) {
    e.preventDefault()
    const problem = validateTx(f, today()) ?? (isNew ? validateNewAsset(na) : null)
    if (problem) return setError(problem)
    setBusy(true)
    try {
      if (editing && prev) {
        const ref = { id: prev.id, index: editing.index, date: prev.date, type: String(prev.type) }
        await edit.save(c.selectedId, editing.assetId, ref, buildTx(f, newId, prev))
      } else if (isNew) {
        await edit.add(c.selectedId, assetKey(na.ticker), buildTx(f, newId), buildAsset(na))
      } else {
        await edit.add(c.selectedId, assetId, buildTx(f, newId))
      }
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Salvataggio non riuscito: controlla la connessione e riprova.')
      setBusy(false)
    }
  }

  return (
    <form className="card note-form" onSubmit={submit}>
      <h2>{editing ? 'Modifica movimento' : 'Nuovo movimento'}</h2>
      {editing?.fromBroker && (
        <p className="muted small">Questo movimento arriva da IBKR. Se lo modifichi resta collegato all'ordine, ma la prossima sincronizzazione non lo corregge più.</p>
      )}
      <div className="pills" role="radiogroup" aria-label="Tipo">
        {(Object.keys(EDITABLE_LABEL) as EditableType[]).map(t => (
          <button key={t} type="button" role="radio" aria-checked={f.type === t} className={`pill small-pill ${f.type === t ? 'active' : ''}`} onClick={() => set('type', t)}>
            {EDITABLE_LABEL[t]}
          </button>
        ))}
      </div>

      <label>
        Titolo
        <select value={assetId} onChange={e => setAssetId(e.target.value)} disabled={!!editing}>
          {assets.map(a => <option key={a.id} value={a.id}>{a.label} ({a.currency})</option>)}
          {!editing && <option value={NEW}>+ Titolo nuovo…</option>}
        </select>
      </label>

      {isNew && (
        <fieldset className="new-asset">
          <div className="form-row">
            <label>Ticker (Yahoo)<input value={na.ticker} onChange={e => setNa({ ...na, ticker: e.target.value })} placeholder="es. NVDA o RACE.MI" autoCapitalize="characters" /></label>
            <label>Valuta<input value={na.valuta} onChange={e => setNa({ ...na, valuta: e.target.value })} maxLength={3} autoCapitalize="characters" /></label>
          </div>
          <div className="form-row">
            <label>Nome (facoltativo)<input value={na.nome} onChange={e => setNa({ ...na, nome: e.target.value })} /></label>
            <label>Tipo
              <select value={na.tipoAsset} onChange={e => setNa({ ...na, tipoAsset: e.target.value })}>
                {ASSET_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
            </label>
          </div>
          <label>ISIN (facoltativo)<input value={na.isin} onChange={e => setNa({ ...na, isin: e.target.value })} autoCapitalize="characters" /></label>
        </fieldset>
      )}

      <div className="form-row">
        <label>Data<input type="date" value={f.date} max={today()} onChange={e => set('date', e.target.value)} /></label>
        <label>Quantità<input inputMode="decimal" value={f.qty} onChange={e => set('qty', e.target.value)} /></label>
      </div>
      <div className="form-row">
        <label>Prezzo ({currency})<input inputMode="decimal" value={f.price} onChange={e => set('price', e.target.value)} /></label>
        <label>Commissioni
          <span className="inline-pair">
            <input inputMode="decimal" value={f.commission} onChange={e => set('commission', e.target.value)} placeholder="0" />
            <select value={f.commissionCurrency} onChange={e => set('commissionCurrency', e.target.value)} aria-label="Valuta delle commissioni">
              {[...new Set(['EUR', currency])].map(x => <option key={x} value={x}>{x}</option>)}
            </select>
          </span>
        </label>
      </div>
      {f.type === 'buy' && (
        <label className="check"><input type="checkbox" checked={f.pac} onChange={e => set('pac', e.target.checked)} /> Rata di un PAC</label>
      )}
      {Number.isFinite(gross) && gross > 0 && <p className="muted small">Controvalore: {money(gross, currency)}. Il cambio storico lo applica il calcolo da solo.</p>}
      <p className="auth-error" role="alert">{error}</p>
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Salvo…' : 'Salva'}</button>
        <button type="button" className="btn btn-ghost" onClick={onClose}>Annulla</button>
      </div>
    </form>
  )
}

/** Trasferimento di un titolo in un altro portafoglio (es. da Mediolanum a IBKR). */
export function TransferFormCard({ c, onClose }: { c: Ready; onClose: () => void }) {
  const edit = usePortfolioEdit()
  const state = usePortfolioState()
  const open = Object.entries(c.portfolio.assets ?? {})
    .map(([id, a]) => ({ id, a, label: symbolOf(a, id), pos: c.result.positions[id] }))
    .filter(x => x.pos && x.pos.qty > 1e-9)
    .sort((x, y) => x.label.localeCompare(y.label))
  const others = c.options.filter(o => o.id !== c.selectedId)

  const [assetId, setAssetId] = useState(open[0]?.id ?? '')
  const [destId, setDestId] = useState(others[0]?.id ?? '')
  const [date, setDate] = useState(today())
  const [qty, setQty] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const sel = open.find(x => x.id === assetId)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!sel || !destId) return setError('Scegli titolo e portafoglio di destinazione.')
    const problem = validateTransfer({ date, qty }, sel.pos!.qty, today())
    if (problem) return setError(problem)
    setBusy(true)
    try {
      await edit.transfer(
        { pid: c.selectedId, aid: sel.id, asset: sel.a },
        { pid: destId, assets: (state.status === 'ready' ? state.data?.portfolios?.[destId]?.assets : undefined) as Record<string, RawAsset> | undefined },
        { date, qty },
        sel.pos!.pmcNative,
      )
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Salvataggio non riuscito: controlla la connessione e riprova.')
      setBusy(false)
    }
  }

  if (!open.length || !others.length) {
    return (
      <div className="card">
        <h2>Trasferimento</h2>
        <p className="muted">{others.length ? 'In questo portafoglio non ci sono titoli da trasferire.' : 'Serve un secondo portafoglio come destinazione.'}</p>
        <button type="button" className="btn btn-ghost" onClick={onClose}>Chiudi</button>
      </div>
    )
  }

  return (
    <form className="card note-form" onSubmit={submit}>
      <h2>Trasferisci un titolo</h2>
      <label>Titolo
        <select value={assetId} onChange={e => setAssetId(e.target.value)}>
          {open.map(x => <option key={x.id} value={x.id}>{x.label} — {fmtQty(x.pos!.qty)} in portafoglio</option>)}
        </select>
      </label>
      <label>Verso
        <select value={destId} onChange={e => setDestId(e.target.value)}>
          {others.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      </label>
      <div className="form-row">
        <label>Data<input type="date" value={date} max={today()} onChange={e => setDate(e.target.value)} /></label>
        <label>Quantità<input inputMode="decimal" value={qty} onChange={e => setQty(e.target.value)} placeholder={sel ? String(sel.pos!.qty) : ''} /></label>
      </div>
      {sel && <p className="muted small">Costo medio che passa con il titolo: {money(sel.pos!.pmcNative, (sel.a.valuta || 'EUR').toUpperCase())}. Le due metà (uscita e entrata) restano collegate.</p>}
      <p className="auth-error" role="alert">{error}</p>
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Salvo…' : 'Trasferisci'}</button>
        <button type="button" className="btn btn-ghost" onClick={onClose}>Annulla</button>
      </div>
    </form>
  )
}
