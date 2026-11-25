// Finestra "Storico" di un titolo (come ui/history.js del sito vecchio): riepilogo, tutti i movimenti con
// prezzo in valuta e in euro, cambio, PMC dopo ogni movimento, plus/minus lorda e netta, avvisi, modifica ed eliminazione.
import { useState } from 'react'
import type { Computed } from '../data/useComputedPortfolio'
import { isEditableMovement, isTransferMovement, useMovementRemove } from '../data/useMovementRemove'
import { usePortfolioEdit } from '../data/usePortfolioEdit'
import { toast } from '../lib/toast'
import { assetHistory, type HistoryRow } from '../domain/assetHistory'
import { KIND_LABEL, type Movement } from '../domain/engine/movements'
import { eur, money, qty as fmtQty, tone } from '../lib/format'
import { MovementForm, TransferEditCard } from './MovementForms'
import { Tag, TagButton } from './Tag'
import { KIND_TONE } from './tones'

type Ready = Extract<Computed, { status: 'ready' }>
const fmtDate = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('it-IT')
const rateFmt = new Intl.NumberFormat('it-IT', { minimumFractionDigits: 4, maximumFractionDigits: 4 })

export function AssetHistory({ c, assetId }: { c: Ready; assetId: string }) {
  const { rows, summary } = assetHistory(c.portfolio, c.result, assetId)
  const currency = rows[0]?.m.currency ?? (c.portfolio.assets?.[assetId]?.valuta || 'EUR').toUpperCase()
  const foreign = currency !== 'EUR'
  const [inEur, setInEur] = useState(false)
  const [asc, setAsc] = useState(false)
  const [editing, setEditing] = useState<Movement | null>(null)
  const [error, setError] = useState('')
  const remove = useMovementRemove(c)
  const edit = usePortfolioEdit()
  const [confirming, setConfirming] = useState<Set<string> | null>(null)
  const [busy, setBusy] = useState(false)
  const estimated = rows.filter(r => r.m.estimated).map(r => r.m)
  const refOf = (m: Movement) => {
    const t = c.portfolio.assets?.[m.assetId]?.transactions?.[m.index]
    return { id: m.txId, index: m.index, date: t?.date ?? m.date, type: String(t?.type ?? m.kind) }
  }
  const confirmNow = async (ms: Movement[]) => {
    if (!ms.length) return
    setError('')
    setBusy(true)
    try {
      await edit.confirm(c.selectedId, assetId, ms.map(refOf))
      toast(ms.length === 1 ? 'Movimento confermato' : `${ms.length} movimenti confermati`)
      setConfirming(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Conferma non riuscita.')
    } finally {
      setBusy(false)
    }
  }

  if (editing) {
    return isTransferMovement(editing)
      ? <TransferEditCard c={c} movement={editing} onClose={() => setEditing(null)} />
      : <MovementForm c={c} editing={editing} onClose={() => setEditing(null)} bare />
  }

  if (confirming) {
    const chosen = estimated.filter(m => confirming.has(m.key))
    const toggle = (k: string) => setConfirming(prev => {
      const n = new Set(prev)
      if (n.has(k)) n.delete(k)
      else n.add(k)
      return n
    })
    return (
      <div className="history">
        <h3>Confermare {estimated.length === 1 ? 'il movimento' : `${estimated.length} movimenti`} di {rows[0]?.m.symbol}?</h3>
        <p className="muted small">
          Quantità e prezzo restano quelli che vedi. Togli il segno alle righe che non coincidono con le conferme d'ordine
          e correggile con la matita.
        </p>
        <ul className="confirm-list">
          {estimated.map(m => (
            <li key={m.key}>
              <label>
                <input type="checkbox" checked={confirming.has(m.key)} onChange={() => toggle(m.key)} />
                <span>{fmtDate(m.date)}{m.pac && <span className="badge">PAC</span>}</span>
                <span>{fmtQty(m.qty)} × {money(m.price, currency)}</span>
              </label>
            </li>
          ))}
        </ul>
        {error && <p className="auth-error" role="alert">{error}</p>}
        <div className="form-actions">
          <button type="button" className="btn btn-primary" disabled={busy || !chosen.length} onClick={() => void confirmNow(chosen)}>
            {busy ? 'Confermo…' : `Conferma ${chosen.length}`}
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => setConfirming(null)}>Annulla</button>
        </div>
      </div>
    )
  }

  const list = asc ? [...rows].reverse() : rows
  const price = (r: HistoryRow) => (inEur ? eur(r.priceEur) : money(r.m.price, currency))
  const total = (r: HistoryRow) => (inEur ? eur(r.rate ? r.totalNative / r.rate : foreign ? null : r.totalNative) : money(r.totalNative, currency))
  const pmc = (r: HistoryRow) => (r.pmcNativeAfter === null ? '—' : inEur ? eur(r.pmcEurAfter) : money(r.pmcNativeAfter, currency))
  const comm = (r: HistoryRow) => (r.m.commission ? money(r.m.commission, r.m.commissionCurrency) : '—')
  const canEdit = (m: Movement) => isEditableMovement(m) || isTransferMovement(m)
  const onRemove = async (m: Movement) => {
    setError('')
    const e = await remove(m)
    if (e) setError(e)
  }
  const kind = (r: HistoryRow) => (
    <>
      <Tag tone={KIND_TONE[r.m.kind]}>{KIND_LABEL[r.m.kind]}</Tag>
      {r.m.pac && <span className="badge">PAC</span>}
      {r.m.estimated && <span className="badge badge-warn" title="Prezzo di chiusura di borsa: modifica il movimento per inserire quello vero">da confermare</span>}
      {r.issues.length > 0 && <span className="warn-tri" title={r.issues.join('\n')} aria-label={`Attenzione: ${r.issues.join('; ')}`}>⚠</span>}
    </>
  )
  const actions = (m: Movement) =>
    canEdit(m) ? (
      <span className="row-actions row-actions-compact">
        {m.estimated && <TagButton tone="confirm" title="Conferma così com'è" onClick={() => void confirmNow([m])}><span className="sr-only">Conferma</span></TagButton>}
        <TagButton tone="edit" title="Modifica" onClick={() => setEditing(m)}><span className="sr-only">Modifica</span></TagButton>
        <TagButton tone="delete" title="Elimina" onClick={() => void onRemove(m)}><span className="sr-only">Elimina</span></TagButton>
      </span>
    ) : null

  return (
    <div className="history">
      <div className="history-head">
        {summary.pac && <span className="badge">PAC</span>}
        {foreign && (
          <div className="seg" role="group" aria-label="Valuta degli importi">
            <span className="seg-label">Importi in</span>
            <button type="button" aria-pressed={!inEur} onClick={() => setInEur(false)}>{currency}</button>
            <button type="button" aria-pressed={inEur} onClick={() => setInEur(true)}>EUR</button>
          </div>
        )}
      </div>

      <dl className="history-summary">
        <div><dt>Quantità</dt><dd>{fmtQty(summary.qty)}</dd></div>
        <div><dt>PMC</dt><dd>{money(summary.pmcNative, currency)}{foreign && <small className="muted"> · {eur(summary.pmcEur)}</small>}</dd></div>
        <div><dt>Realizzato</dt><dd className={tone(summary.realizedEur)}>{eur(summary.realizedEur, true)}<small className="muted"> · netto {eur(summary.realizedNetEur, true)}</small></dd></div>
        <div><dt>Commissioni</dt><dd>{eur(summary.commissionsEur)}</dd></div>
      </dl>

      {foreign && (
        <p className="muted small history-note">
          Il PMC in euro e le plus/minus usano il cambio Banca d'Italia del giorno di ogni movimento, come vuole il fisco.
          Il broker mostra il PMC in {currency}: convertito al cambio di oggi dà un risultato diverso, ed è normale.
        </p>
      )}
      {estimated.length > 0 && (
        <div className="confirm-banner">
          <div>
            <b>{estimated.length} {estimated.length === 1 ? 'movimento' : 'movimenti'} da confermare</b>
            <span className="small">Prezzo stimato dalla chiusura di borsa. Confermali se coincidono con le conferme d'ordine, altrimenti correggili con la matita.</span>
          </div>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => setConfirming(new Set(estimated.map(m => m.key)))}>Conferma tutte</button>
        </div>
      )}
      {error && <p className="auth-error" role="alert">{error}</p>}

      {/* PC: tabella */}
      <table className="pos-table history-table">
        <thead>
          <tr>
            <th><button type="button" className="th-sort active" onClick={() => setAsc(v => !v)}>Data<span className="sort-arrow">{asc ? '▲' : '▼'}</span></button></th>
            <th>Tipo</th><th className="num">Q.tà</th><th className="num">Prezzo</th><th className="num">Comm.</th><th className="num">Totale</th>
            {foreign && <th className="num">€/{currency}</th>}
            <th className="num">PMC dopo</th><th className="num">P&L lordo</th><th className="num">P&L netto</th><th></th>
          </tr>
        </thead>
        <tbody>
          {list.map(r => (
            <tr key={r.m.key} className={r.issues.length ? 'row-warn' : ''}>
              <td>{fmtDate(r.m.date)}</td>
              <td>{kind(r)}</td>
              <td className="num">{fmtQty(r.m.qty)}</td>
              <td className="num">{price(r)}{!inEur && foreign && <small className="cell-sub muted">{eur(r.priceEur)}</small>}</td>
              <td className="num">{comm(r)}</td>
              <td className="num">{total(r)}</td>
              {foreign && <td className="num">{r.rate ? rateFmt.format(r.rate) : '—'}</td>}
              <td className="num">{pmc(r)}</td>
              <td className={`num ${tone(r.gainEur)}`}>{r.gainEur === null ? '' : eur(r.gainEur, true)}</td>
              <td className={`num ${tone(r.netEur)}`}>{r.netEur === null ? '' : <>{eur(r.netEur, true)}<small className="cell-sub muted">tasse {eur(r.taxEur)}</small></>}</td>
              <td className="num">{actions(r.m)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Telefono: un riquadro per movimento */}
      <ul className="history-list">
        {list.map(r => (
          <li key={r.m.key} className={`card ${r.issues.length ? 'row-warn' : ''}`}>
            <div className="mov-head">{kind(r)}<span className="muted mov-date">{fmtDate(r.m.date)}</span></div>
            <div className="mov-body">
              <span>{fmtQty(r.m.qty)} × {price(r)} = {total(r)}</span>
              {r.netEur !== null && <b className={tone(r.gainEur)}>{eur(r.gainEur, true)}</b>}
            </div>
            <div className="muted small">
              PMC dopo {pmc(r)}
              {r.rate && <> · cambio {rateFmt.format(r.rate)}</>}
              {r.m.commission > 0 && <> · comm. {comm(r)}</>}
              {r.netEur !== null && <> · netto {eur(r.netEur, true)} (tasse {eur(r.taxEur)})</>}
            </div>
            {r.issues.length > 0 && <p className="small warn-text">⚠ {r.issues.join('; ')}</p>}
            {actions(r.m)}
          </li>
        ))}
      </ul>
      {!rows.length && <p className="muted">Nessun movimento per questo titolo.</p>}
    </div>
  )
}
