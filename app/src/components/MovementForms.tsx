import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import type { Computed } from '../data/useComputedPortfolio'
import { usePortfolioEdit } from '../data/usePortfolioEdit'
import { usePortfolioState } from '../data/usePortfolioState'
import type { RawAsset } from '../domain/engine/types'
import type { Movement } from '../domain/engine/movements'
import { symbolOf } from '../domain/engine/valuation'
import {
  ASSET_TYPES, assetKey, buildAsset, buildTx, EDITABLE_LABEL, findTransfer, formFromTx, heldQty, validateNewAsset, validateTransfer, validateTx,
  type PortfolioLike,
  type EditableType, type NewAssetForm, type TxForm,
} from '../domain/txEdit'
import { previewMovement, type MovementPreview } from '../domain/movementPreview'
import { eur, money, qty as fmtQty, tone } from '../lib/format'
import { localToday } from '../lib/today'

type Ready = Extract<Computed, { status: 'ready' }>
const today = () => localToday()
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
const NEW = '__new__'

/** Nuovo movimento (acquisto, vendita, short, PAC) o modifica di uno esistente. */
/** Titolo e tipo già scelti (dai pulsanti sulla riga in Posizioni). `bare`: dentro una finestra, senza riquadro e titolo. */
export interface MovementPreset {
  assetId: string
  type: EditableType
}

/** Quantità massima sensata: tutto ciò che si ha (vendita) o tutto lo short (chiusura). */
const maxFor = (type: EditableType, held: number) => (type === 'sell' ? Math.max(held, 0) : type === 'buy_to_cover' ? Math.max(-held, 0) : 0)

export function MovementForm({ c, editing, onClose, preset, bare }: { c: Ready; editing?: Movement; onClose: () => void; preset?: MovementPreset; bare?: boolean }) {
  const edit = usePortfolioEdit()
  const assets = Object.entries(c.portfolio.assets ?? {})
    .map(([id, a]) => ({ id, label: symbolOf(a, id), currency: (a.valuta || 'EUR').toUpperCase() }))
    .sort((a, b) => a.label.localeCompare(b.label))

  const [assetId, setAssetId] = useState(editing?.assetId ?? preset?.assetId ?? assets[0]?.id ?? NEW)
  const [na, setNa] = useState<NewAssetForm>({ ticker: '', nome: '', valuta: 'EUR', tipoAsset: 'stock', isin: '' })
  const isNew = assetId === NEW
  const currency = isNew ? na.valuta.trim().toUpperCase() || 'EUR' : assets.find(a => a.id === assetId)?.currency ?? 'EUR'

  const prev = editing ? c.portfolio.assets?.[editing.assetId]?.transactions?.[editing.index] : undefined
  const [f, setF] = useState<TxForm>(
    prev && editing
      ? formFromTx(prev, currency)
      : {
          type: preset?.type ?? 'buy',
          date: today(),
          // Vendita e chiusura short partono da tutta la quantità (MAX), come nel sito vecchio.
          qty: preset ? String(maxFor(preset.type, c.result.positions[preset.assetId]?.qty ?? 0) || '') : '',
          price: '',
          commission: '',
          commissionCurrency: 'EUR',
          pac: false,
        },
  )
  const held = isNew ? 0 : c.result.positions[assetId]?.qty ?? 0
  const max = maxFor(f.type, held)
  const quote = c.rows.find(r => r.assetId === assetId)?.price ?? null
  const set = <K extends keyof TxForm>(k: K, v: TxForm[K]) => setF(x => ({ ...x, [k]: v }))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Anteprima con il motore vero (prezzo attuale se il prezzo non è ancora scritto).
  const priced = f.price.trim() || quote === null || editing ? f : { ...f, price: String(quote) }
  const previewKey = JSON.stringify([priced, assetId, isNew && na])
  const preview = useMemo(() => {
    if (validateTx(priced, '9999-12-31')) return null
    try {
      return previewMovement({
        portfolio: c.portfolio, fx: c.fx, latestFx: c.latestFx,
        assetId: isNew ? assetKey(na.ticker || 'nuovo') : assetId,
        tx: buildTx(priced, () => 'nuovo', prev),
        replaceIndex: editing?.index,
        newAsset: isNew ? buildAsset(na) : undefined,
      })
    } catch {
      return null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey, c.portfolio, c.fx, c.latestFx])

  async function submit(e: FormEvent) {
    e.preventDefault()
    const problem = validateTx(f, today()) ?? (isNew ? validateNewAsset(na) : null)
    if (problem) return setError(problem)
    if (preview?.overLimit) return setError(overLimitText(preview.overLimit, f.type))
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
    <form className={bare ? 'note-form' : 'card note-form'} onSubmit={submit}>
      {!bare && <h2>{editing ? 'Modifica movimento' : 'Nuovo movimento'}</h2>}
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
        <label>
          Quantità
          <span className="inline-pair">
            <input inputMode="decimal" value={f.qty} onChange={e => set('qty', e.target.value)} />
            {max > 0 && <button type="button" className="btn btn-ghost" onClick={() => set('qty', String(max))}>MAX</button>}
          </span>
        </label>
      </div>
      {!isNew && !editing && <p className="muted small">In portafoglio: {fmtQty(held)}{quote !== null && <> · prezzo attuale {money(quote, currency)}</>}</p>}
      <div className="form-row">
        <label>Prezzo ({currency})<input inputMode="decimal" value={f.price} onChange={e => set('price', e.target.value)} placeholder={quote !== null && !editing ? String(quote) : ''} /></label>
        <label>Commissioni
          <span className="inline-pair">
            <input inputMode="decimal" value={f.commission} onChange={e => set('commission', e.target.value)} placeholder="0" />
            <select value={f.commissionCurrency} onChange={e => set('commissionCurrency', e.target.value)} aria-label="Valuta delle commissioni">
              {[...new Set(['EUR', currency, 'USD', 'CAD'])].map(x => <option key={x} value={x}>{x}</option>)}
            </select>
          </span>
        </label>
      </div>
      {f.type === 'buy' && (
        <label className="check"><input type="checkbox" checked={f.pac} onChange={e => set('pac', e.target.checked)} /> Rata di un PAC</label>
      )}
      {preview && <PreviewBox p={preview} type={f.type} currency={currency} atQuote={priced !== f} regime={c.result.regime} />}
      <p className="auth-error" role="alert">{error}</p>
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Salvo…' : 'Salva'}</button>
        <button type="button" className="btn btn-ghost" onClick={onClose}>Annulla</button>
      </div>
    </form>
  )
}

/** Trasferimento di un titolo in un altro portafoglio (es. da Mediolanum a IBKR). */
export function TransferFormCard({ c, onClose, presetAssetId, bare }: { c: Ready; onClose: () => void; presetAssetId?: string; bare?: boolean }) {
  const edit = usePortfolioEdit()
  const state = usePortfolioState()
  const open = Object.entries(c.portfolio.assets ?? {})
    .map(([id, a]) => ({ id, a, label: symbolOf(a, id), pos: c.result.positions[id] }))
    .filter(x => x.pos && x.pos.qty > 1e-9)
    .sort((x, y) => x.label.localeCompare(y.label))
  const others = c.options.filter(o => o.id !== c.selectedId)

  const [assetId, setAssetId] = useState(presetAssetId && open.some(x => x.id === presetAssetId) ? presetAssetId : open[0]?.id ?? '')
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
    <form className={bare ? 'note-form' : 'card note-form'} onSubmit={submit}>
      {!bare && <h2>Trasferisci un titolo</h2>}
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
        <label>
          Quantità
          <span className="inline-pair">
            <input inputMode="decimal" value={qty} onChange={e => setQty(e.target.value)} placeholder={sel ? String(sel.pos!.qty) : ''} />
            {sel && <button type="button" className="btn btn-ghost" onClick={() => setQty(String(sel.pos!.qty))}>MAX</button>}
          </span>
        </label>
      </div>
      {sel && (
        <ul className="plain-list transfer-summary">
          <li><span>PMC attuale</span><b>{money(sel.pos!.pmcNative, (sel.a.valuta || 'EUR').toUpperCase())}</b></li>
          <li><span>Quantità disponibile</span><b>{fmtQty(sel.pos!.qty)}</b></li>
          <li><span>Prezzo usato</span><b>il PMC (nessuna plus o minus)</b></li>
          <li><span>Commissioni</span><b>nessuna</b></li>
        </ul>
      )}
      {sel && Number(qty.replace(',', '.')) >= sel.pos!.qty - 1e-9 && (
        <p className="muted small">Trasferimento totale: il titolo passerà nel gruppo "Trasferiti" di questo portafoglio.</p>
      )}
      <p className="muted small">Uscita ed entrata restano collegate: il costo e le date degli acquisti originali passano con il titolo.</p>
      <p className="auth-error" role="alert">{error}</p>
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Salvo…' : 'Trasferisci'}</button>
        <button type="button" className="btn btn-ghost" onClick={onClose}>Annulla</button>
      </div>
    </form>
  )
}

/** Correzione di un trasferimento (data e quantità): uscita ed entrata cambiano insieme. */
export function TransferEditCard({ c, movement, onClose }: { c: Ready; movement: Movement; onClose: () => void }) {
  const edit = usePortfolioEdit()
  const state = usePortfolioState()
  const portfolios = (state.status === 'ready' ? state.data?.portfolios : undefined) as Record<string, PortfolioLike> | undefined
  const tx = c.portfolio.assets?.[movement.assetId]?.transactions?.[movement.index]
  const pair = portfolios && tx?.transferId ? findTransfer(portfolios, tx.transferId) : {}
  const nameOf = (pid?: string) => c.options.find(o => o.id === pid)?.name ?? 'altro portafoglio'
  const [date, setDate] = useState(tx?.date ?? today())
  const [qty, setQty] = useState(tx ? String(tx.qty) : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!portfolios || !tx?.transferId) return setError('Trasferimento non trovato: chiudi e riprova.')
    const txsOf = (l?: { pid: string; aid: string }) => (l ? portfolios[l.pid]?.assets?.[l.aid]?.transactions ?? [] : [])
    const oldQty = Number(tx.qty) || 0
    // Da dove esce deve esserci abbastanza; dove entra non si può togliere più di quanto resta.
    const available = pair.out ? heldQty(txsOf(pair.out), pair.out.tx) : Infinity
    const problem = validateTransfer({ date, qty }, available, today())
    if (problem) return setError(problem)
    const newQty = Number(qty.replace(',', '.'))
    if (pair.in && newQty < oldQty && heldQty(txsOf(pair.in)) < oldQty - newQty - 1e-9) {
      return setError(`In ${nameOf(pair.in.pid)} ne sono già stati venduti: puoi ridurre il trasferimento al massimo di ${fmtQty(heldQty(txsOf(pair.in)))}.`)
    }
    setBusy(true)
    try {
      await edit.changeTransfer(portfolios, tx.transferId, { form: { date, qty } })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Salvataggio non riuscito: controlla la connessione e riprova.')
      setBusy(false)
    }
  }

  return (
    <form className="card note-form" onSubmit={submit}>
      <h2>Modifica trasferimento</h2>
      <p className="muted small">
        {movement.symbol}: da {nameOf(pair.out?.pid)} a {nameOf(pair.in?.pid)}.
        {pair.out && pair.in ? ' Uscita ed entrata si correggono insieme.' : ' Manca l’altra metà: si corregge solo questa.'}
      </p>
      <div className="form-row">
        <label>Data<input type="date" value={date} max={today()} onChange={e => setDate(e.target.value)} /></label>
        <label>Quantità<input inputMode="decimal" value={qty} onChange={e => setQty(e.target.value)} /></label>
      </div>
      <p className="auth-error" role="alert">{error}</p>
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Salvo…' : 'Salva'}</button>
        <button type="button" className="btn btn-ghost" onClick={onClose}>Annulla</button>
      </div>
    </form>
  )
}

const overLimitText = (o: NonNullable<MovementPreview['overLimit']>, type: EditableType) =>
  o.own
    ? `Puoi ${type === 'buy_to_cover' ? 'ricoprire' : 'vendere'} al massimo ${fmtQty(o.available)} (quanti ne avevi in quella data).`
    : `Con questo movimento la chiusura del ${new Date(o.date + 'T12:00:00').toLocaleDateString('it-IT')} supererebbe i titoli posseduti (ne resterebbero ${fmtQty(o.available)}).`

/** Cosa succede salvando il movimento: come l'anteprima del sito vecchio. */
function PreviewBox({ p, type, currency, atQuote, regime }: { p: MovementPreview; type: EditableType; currency: string; atQuote: boolean; regime: string }) {
  const closes = type === 'sell' || type === 'buy_to_cover'
  const row = (label: string, value: ReactNode, cls = '') => <li><span>{label}</span><b className={cls}>{value}</b></li>
  if (p.overLimit) return <p className="auth-error" role="alert">{overLimitText(p.overLimit, type)}</p>
  const pmc = (s: MovementPreview['before']) => (currency === 'EUR' ? eur(s.pmcEur) : `${money(s.pmcNative, currency)} · ${eur(s.pmcEur)}`)
  return (
    <div className="preview-box" aria-live="polite">

      <ul className="plain-list transfer-summary">
        {row(type === 'buy' || type === 'buy_to_cover' ? 'Spesa' : 'Incasso lordo', currency === 'EUR' ? eur(p.grossEur) : `${money(p.grossNative, currency)} · ${eur(p.grossEur)}`)}
        {p.commissionEur > 0 && row('Commissioni', eur(p.commissionEur))}
        {closes && p.gainEur !== null && row(p.gainEur >= 0 ? 'Plus' : 'Minus', eur(p.gainEur, true), tone(p.gainEur))}
        {closes && p.lossesUsedEur > 0.005 && row('Minus compensate', eur(p.lossesUsedEur))}
        {closes && Math.abs(p.taxEur) > 0.005 && row(regime === 'dichiarativo' ? 'Imposta (da dichiarare)' : 'Imposta trattenuta', eur(p.taxEur))}
        {row(p.cashEur >= 0 ? 'Incasso netto' : 'Uscita netta', eur(Math.abs(p.cashEur)))}
        {row('Quantità', `${fmtQty(p.before.qty)} → ${fmtQty(p.after.qty)}`)}
        {Math.abs(p.after.qty) > 1e-9 && row(p.after.qty < 0 ? 'Prezzo medio short' : 'PMC', Math.abs(p.before.qty) > 1e-9 && Math.abs(p.before.pmcEur - p.after.pmcEur) > 0.0005 ? <>{pmc(p.before)} → {pmc(p.after)}</> : pmc(p.after))}
      </ul>
      <p className="muted small">
        {atQuote ? 'Calcolato al prezzo attuale. ' : ''}
        {p.fxEstimated ? "Cambio di quel giorno non ancora noto: stima con l'ultimo disponibile." : currency !== 'EUR' ? "Cambio Banca d'Italia del giorno." : ''}
      </p>
    </div>
  )
}
