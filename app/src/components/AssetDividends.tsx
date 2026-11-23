// Finestra "Dividendi" di un titolo (come ui/dividendi.js del sito vecchio).
import { useEffect, useState } from 'react'
import type { Computed } from '../data/useComputedPortfolio'
import { useDividendActuals } from '../data/useDividendActuals'
import { useYahooDividends } from '../data/useYahooDividends'
import { ANOMALY_SHARE, assetDividends, PAY_DELAY_DAYS, type AssetDividendRow } from '../domain/assetDividends'
import { dividendsFromCashflows, qtyBefore, type CashflowLike } from '../domain/engine/dividends'
import type { FxLookup } from '../domain/engine/types'
import { symbolOf } from '../domain/engine/valuation'
import { loadFx } from '../lib/fxRates'
import { eur, money, qty as fmtQty } from '../lib/format'
import { Kpi } from './PortfolioPicker'
import { localToday } from '../lib/today'

type Ready = Extract<Computed, { status: 'ready' }>
const TODAY = localToday()
const fmtDate = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('it-IT')
const num = (s: string) => Number(s.trim().replace(',', '.'))

export function AssetDividends({ c, assetId }: { c: Ready; assetId: string }) {
  const asset = c.portfolio.assets?.[assetId]
  const symbol = asset ? symbolOf(asset, assetId) : assetId
  const currency = (asset?.valuta || 'EUR').toUpperCase()
  const yahoo = useYahooDividends([symbol])[symbol]
  const [manual, saveManual] = useDividendActuals(c.selectedId, assetId)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')

  // Cambi Banca d'Italia dei giorni di stacco (non sono tra quelli dei movimenti).
  const exKey = (yahoo ?? []).map(d => d.exDate).filter(d => d <= TODAY && qtyBefore(asset?.transactions ?? [], d) > 0).join(',')
  const [fx, setFx] = useState<{ key: string; lookup: FxLookup } | null>(null)
  useEffect(() => {
    if (!exKey || currency === 'EUR') return
    let alive = true
    void loadFx(exKey.split(',')).then(lookup => alive && setFx({ key: exKey, lookup }))
    return () => {
      alive = false
    }
  }, [exKey, currency])

  if (!asset) return <p className="muted">Titolo non trovato.</p>
  const loading = yahoo === undefined || (currency !== 'EUR' && exKey !== '' && fx?.key !== exKey)
  if (loading) return <div className="card skeleton" style={{ height: 160 }} />

  const flows = (c.portfolio as { cashflows?: CashflowLike[] }).cashflows ?? []
  const broker = dividendsFromCashflows(flows, c.result.regime, c.fx)
  const { rows, summary } = assetDividends({
    asset, assetId, yahoo: yahoo ?? [], regime: c.result.regime, fx: fx?.lookup ?? (() => undefined), today: TODAY, broker, manual,
  })

  const startEdit = (r: AssetDividendRow) => {
    setEditing(r.exDate)
    setDraft(r.realNetEur != null ? r.realNetEur.toFixed(2).replace('.', ',') : '')
    setError('')
  }
  const commit = async (exDate: string) => {
    const v = draft.trim() === '' ? null : num(draft)
    if (v !== null && !(v >= 0)) return setError('Scrivi un importo in euro (o lascia vuoto per toglierlo).')
    try {
      await saveManual(exDate, v)
      setEditing(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Salvataggio non riuscito.')
    }
  }
  const real = (r: AssetDividendRow) =>
    r.realSource === 'ibkr' ? (
      <span title="Accredito vero dai movimenti di cassa IBKR">{eur(r.realNetEur)} <small className="muted">IBKR</small></span>
    ) : editing === r.exDate ? (
      <span className="inline-pair div-edit">
        <input inputMode="decimal" value={draft} onChange={e => setDraft(e.target.value)} aria-label="Netto accreditato in euro" />
        <button type="button" className="btn btn-primary btn-small" onClick={() => void commit(r.exDate)}>Salva</button>
      </span>
    ) : (
      <button type="button" className="linklike" onClick={() => startEdit(r)} title="Scrivi il netto davvero accreditato">
        {r.realNetEur != null ? eur(r.realNetEur) : '—'} ✎
      </button>
    )
  const status = (r: AssetDividendRow) => (
    <span className={`badge ${r.status === 'pagato' ? 'badge-paid' : 'badge-warn'}`}>{r.status === 'pagato' ? 'Pagato' : 'Maturato'}</span>
  )

  return (
    <div className="history">
      <div className="kpis">
        <Kpi label="Dividendi maturati" value={String(summary.maturedCount)} hint={summary.lastExDate ? `ultimo stacco ${fmtDate(summary.lastExDate)}` : 'nessuno'} />
        <Kpi label="Totale pagato" value={eur(summary.paidEur)} hint={currency !== 'EUR' ? `${money(summary.paidNative, currency)} lordi` : 'lordo'} />
        <Kpi label="Ultimo pagamento" value={summary.lastPayment ? eur(summary.lastPayment.eur) : '—'} hint={summary.lastPayment ? fmtDate(summary.lastPayment.date) : undefined} />
        {summary.anomalies > 0 && <Kpi label="Scostamenti anomali" value={String(summary.anomalies)} className="neg" hint={`oltre il ${ANOMALY_SHARE * 100}% dal netto atteso`} />}
      </div>
      <p className="muted small history-note">
        Dividendi da Yahoo con la quantità posseduta il giorno prima dello stacco; pagamento stimato {PAY_DELAY_DAYS} giorni dopo
        {broker.length ? ", oppure la data vera dell'accredito IBKR" : ''}. Tocca ✎ per scrivere il netto davvero accreditato: oltre il 3% di
        differenza di solito manca il credito per la ritenuta USA.
      </p>
      {error && <p className="auth-error" role="alert">{error}</p>}

      <table className="pos-table history-table">
        <thead>
          <tr>
            <th>Stacco</th><th>Pagamento</th><th>Stato</th><th className="num">Div/azione</th><th className="num">Quantità</th>
            <th className="num">Importo</th><th className="num">Importo €</th><th className="num">Netto atteso</th><th className="num">Netto reale</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.exDate} className={r.anomaly ? 'row-warn' : ''}>
              <td>{fmtDate(r.exDate)}</td>
              <td>{fmtDate(r.payDate)}{r.payDateEstimated && <small className="muted"> (stima)</small>}</td>
              <td>{status(r)}</td>
              <td className="num">{money(r.perShare, currency)}</td>
              <td className="num">{fmtQty(r.qty)}</td>
              <td className="num">{money(r.totalNative, currency)}</td>
              <td className="num">{eur(r.totalEur)}</td>
              <td className="num">{eur(r.expectedNetEur)}</td>
              <td className="num">{r.anomaly && <span className="warn-tri" title="Più del 3% di differenza dal netto atteso">⚠</span>} {real(r)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <ul className="history-list">
        {rows.map(r => (
          <li key={r.exDate} className={`card ${r.anomaly ? 'row-warn' : ''}`}>
            <div className="mov-head">
              {status(r)}
              <span>Stacco {fmtDate(r.exDate)}</span>
              <span className="muted mov-date">pag. {fmtDate(r.payDate)}{r.payDateEstimated ? ' (stima)' : ''}</span>
            </div>
            <div className="mov-body">
              <span>{fmtQty(r.qty)} × {money(r.perShare, currency)} = {money(r.totalNative, currency)}</span>
              <b>{eur(r.totalEur)}</b>
            </div>
            <div className="mov-body small">
              <span className="muted">Netto atteso {eur(r.expectedNetEur)}</span>
              <span>{r.anomaly && <span className="warn-tri">⚠</span>} reale {real(r)}</span>
            </div>
          </li>
        ))}
      </ul>
      {!rows.length && <p className="muted">Nessun dividendo staccato mentre avevi il titolo (dati Yahoo).</p>}
    </div>
  )
}
