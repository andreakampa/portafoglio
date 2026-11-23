import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { ExerciseFormCard } from '../components/ExerciseForm'
import { MovementForm, TransferEditCard, TransferFormCard } from '../components/MovementForms'
import { PacPlansCard } from '../components/PacPlansCard'
import { Kpi, PortfolioPicker } from '../components/PortfolioPicker'
import { Tag, TagButton } from '../components/Tag'
import { KIND_TONE } from '../components/tones'
import { useComputedPortfolio } from '../data/useComputedPortfolio'
import { usePortfolioEdit } from '../data/usePortfolioEdit'
import { isEditableMovement, isTransferMovement, useMovementRemove } from '../data/useMovementRemove'
import { marginOnDate, type MarginOnDate, type MarginPortfolio } from '../domain/engine/margin'
import { buildMovements, CASH_LABEL, cashflowsIn, cashTotalsEur, KIND_LABEL, marginInterest, periodRange, type Movement, type MovementKind, type Period } from '../domain/engine/movements'
import { buildInterest, customRange, isManualInterest, periodTotals, taxByMovement, validateInterest, type InterestForm } from '../domain/movementsView'
import { exportPdf, exportXlsx, type ExportTable } from '../lib/exportTable'
import { eur, money, qty, THIS_YEAR, tone } from '../lib/format'
import { localToday } from '../lib/today'

const TODAY = localToday()
type Filter = 'all' | 'trades' | 'short' | 'transfer'
const FILTERS: { key: Filter; label: string; kinds: MovementKind[] }[] = [
  { key: 'all', label: 'Tutti', kinds: ['buy', 'sell', 'short_sell', 'buy_to_cover', 'transfer_in', 'transfer_out'] },
  { key: 'trades', label: 'Compravendite', kinds: ['buy', 'sell'] },
  { key: 'short', label: 'Short', kinds: ['short_sell', 'buy_to_cover'] },
  { key: 'transfer', label: 'Trasferimenti', kinds: ['transfer_in', 'transfer_out'] },
]
const fmtDate = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('it-IT')

export function Movements() {
  const c = useComputedPortfolio()
  const [tab, setTab] = useState<'trades' | 'interest' | 'cash'>('trades')
  const [period, setPeriod] = useState<Period | 'custom'>('ytd')
  const [range, setRange] = useState({ from: `${THIS_YEAR}-01-01`, to: TODAY })
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const location = useLocation()
  const navigate = useNavigate()
  const [form, setForm] = useState<'new' | 'transfer' | 'exercise' | Movement | null>(() => ((location.state as { nuovo?: boolean } | null)?.nuovo ? 'new' : null))
  // Toccando di nuovo il "+" mentre si è già qui, si riapre il modulo (ogni tocco è una navigazione nuova).
  const wantsNew = !!(location.state as { nuovo?: boolean } | null)?.nuovo
  const [seenKey, setSeenKey] = useState(location.key)
  if (wantsNew && location.key !== seenKey) {
    setSeenKey(location.key)
    setForm('new')
  }
  // Poi si toglie il segnale dalla cronologia, così tornando indietro il modulo non si riapre.
  useEffect(() => {
    if (wantsNew) navigate(location.pathname, { replace: true, state: null })
  }, [wantsNew, location.pathname, navigate])
  const removeMovement = useMovementRemove(c)
  const [delError, setDelError] = useState('')

  const all = useMemo(() => (c.status === 'ready' ? buildMovements(c.portfolio, c.result) : []), [c])

  if (c.status === 'loading') return <section className="page"><h1>Movimenti</h1><div className="card skeleton" style={{ height: 240 }} /></section>
  if (c.status === 'error') return <section className="page"><h1>Movimenti</h1><div className="card error">{c.message}</div></section>
  if (c.status === 'empty') return <section className="page"><h1>Movimenti</h1><div className="card">Nessun portafoglio.</div></section>

  const years = [...new Set(all.map(m => m.date.slice(0, 4)))].filter(y => y !== String(THIS_YEAR)).sort().reverse()
  const [from, to] = period === 'custom' ? customRange(range.from, range.to) : periodRange(period, TODAY)
  const kinds = FILTERS.find(f => f.key === filter)!.kinds
  const q = search.trim().toUpperCase()
  const list = all.filter(m => m.date >= from && m.date < to && kinds.includes(m.kind) && (!q || m.symbol.toUpperCase().includes(q)))
  const taxOf = taxByMovement(c.result.fiscal.lines, list)
  const totals = periodTotals(list, taxOf)
  const periodLabel = period === 'custom' ? `dal ${fmtDate(range.from)} al ${fmtDate(range.to)}` : period === 'all' ? 'tutto' : period === 'ytd' ? String(THIS_YEAR) : period === '1m' ? 'ultimo mese' : period === '3m' ? 'ultimi 3 mesi' : period
  const exportData = (): ExportTable => ({
    title: `Movimenti — ${c.options.find(o => o.id === c.selectedId)?.name ?? ''}`,
    subtitle: `Periodo: ${periodLabel} · plus ${eur(totals.plus)} · minus ${eur(totals.minus)} · imposta stimata ${eur(totals.tax)}`,
    headers: ['Data', 'Titolo', 'Tipo', 'Quantità', 'Prezzo', 'Valuta', 'Controvalore', 'Commissioni', 'Plus/minus €', 'Imposta €'],
    values: list.map(m => [m.date, m.symbol, KIND_LABEL[m.kind], m.qty, m.price, m.currency, m.gross, m.commission || null, m.gainEur, taxOf.get(m.key) ?? null]),
    texts: list.map(m => [fmtDate(m.date), m.symbol, KIND_LABEL[m.kind], qty(m.qty), money(m.price, m.currency), m.currency, money(m.gross, m.currency), m.commission ? money(m.commission, m.commissionCurrency) : '', m.gainEur === null ? '' : eur(m.gainEur, true), taxOf.has(m.key) ? eur(taxOf.get(m.key)!) : '']),
    fileName: `movimenti-${from.slice(0, 10)}`,
  })
  const editable = isEditableMovement
  const isTransfer = isTransferMovement
  const remove = async (m: Movement) => {
    setDelError('')
    const err = await removeMovement(m)
    if (err) setDelError(err)
  }
  const actions = (m: Movement, iconOnly = false) =>
    editable(m) || isTransfer(m) ? (
      <span className={iconOnly ? 'row-actions' : 'note-actions'}>
        <TagButton tone="edit" title={`Modifica ${m.symbol}`} onClick={() => { setForm(m); window.scrollTo({ top: 0, behavior: 'smooth' }) }}>
          {iconOnly ? <span className="sr-only">Modifica {m.symbol}</span> : 'Modifica'}
        </TagButton>
        <TagButton tone="delete" title={`Elimina ${m.symbol}`} onClick={() => void remove(m)}>
          {iconOnly ? <span className="sr-only">Elimina {m.symbol}</span> : 'Elimina'}
        </TagButton>
      </span>
    ) : null
  const marginAt = (m: Movement) => (m.kind === 'buy' ? marginOnDate(c.portfolio as MarginPortfolio, m.date) : null)
  const interest = marginInterest(c.portfolio).filter(r => `${r.period}-01` >= from.slice(0, 8) + '01' && `${r.period}-01` < to)

  const cash = cashflowsIn(c.portfolio as { cashflows?: [] }, from, to)
  const cashEur = cashTotalsEur(cash.items, c.latestFx)

  const periods: { key: Period; label: string }[] = [
    { key: '1m', label: '1 mese' },
    { key: '3m', label: '3 mesi' },
    { key: 'ytd', label: String(THIS_YEAR) },
    ...years.map(y => ({ key: y as Period, label: y })),
    { key: 'all', label: 'Tutto' },
  ]
  const pickPeriod = (k: Period | 'custom') => setPeriod(k)

  return (
    <section className="page">
      <header className="page-head">
        <h1>Movimenti</h1>
        <PortfolioPicker options={c.options} selectedId={c.selectedId} onSelect={c.select} />
      </header>
      <div className="form-actions">
        <button type="button" className="btn btn-primary" onClick={() => setForm('new')}>+ Nuovo movimento</button>
        <button type="button" className="btn btn-ghost" onClick={() => setForm('transfer')}>Trasferisci titolo</button>
        {Object.values(c.portfolio.assets ?? {}).some(a => a.tipoAsset === 'option') && (
          <button type="button" className="btn btn-ghost" onClick={() => setForm('exercise')}>Esercizio / assegnazione</button>
        )}
      </div>
      {form === 'transfer' && <TransferFormCard c={c} onClose={() => setForm(null)} />}
      {form === 'exercise' && <ExerciseFormCard c={c} onClose={() => setForm(null)} />}
      {form && form !== 'transfer' && form !== 'exercise' && form !== 'new' && isTransfer(form) && (
        <TransferEditCard key={form.key} c={c} movement={form} onClose={() => setForm(null)} />
      )}
      {form && form !== 'transfer' && form !== 'exercise' && (form === 'new' || !isTransfer(form)) && (
        <MovementForm key={form === 'new' ? 'new' : form.key} c={c} editing={form === 'new' ? undefined : form} onClose={() => setForm(null)} />
      )}
      {delError && <div className="card error" role="alert">{delError}</div>}
      <PacPlansCard c={c} />

      <div className="pills" role="tablist" aria-label="Sezione">
        <button type="button" role="tab" aria-selected={tab === 'trades'} className={`pill ${tab === 'trades' ? 'active' : ''}`} onClick={() => setTab('trades')}>Operazioni</button>
        <button type="button" role="tab" aria-selected={tab === 'interest'} className={`pill ${tab === 'interest' ? 'active' : ''}`} onClick={() => setTab('interest')}>Interessi margine</button>
        <button type="button" role="tab" aria-selected={tab === 'cash'} className={`pill ${tab === 'cash' ? 'active' : ''}`} onClick={() => setTab('cash')}>Cassa</button>
      </div>

      <div className="pills" role="tablist" aria-label="Periodo">
        {periods.map(p => (
          <button key={p.key} type="button" role="tab" aria-selected={period === p.key} className={`pill small-pill ${period === p.key ? 'active' : ''}`} onClick={() => pickPeriod(p.key)}>
            {p.label}
          </button>
        ))}
        <button type="button" role="tab" aria-selected={period === 'custom'} className={`pill small-pill ${period === 'custom' ? 'active' : ''}`} onClick={() => pickPeriod('custom')}>
          Dal… al…
        </button>
      </div>
      {period === 'custom' && (
        <div className="form-row period-range">
          <label>Dal<input type="date" value={range.from} max={TODAY} onChange={e => setRange({ ...range, from: e.target.value })} /></label>
          <label>Al<input type="date" value={range.to} max={TODAY} onChange={e => setRange({ ...range, to: e.target.value })} /></label>
        </div>
      )}

      {tab === 'trades' ? (
        <>
          <div className="filters">
            <select value={filter} onChange={e => setFilter(e.target.value as Filter)} aria-label="Tipo di movimento">
              {FILTERS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
            </select>
            <input type="search" placeholder="Cerca titolo" value={search} onChange={e => setSearch(e.target.value)} aria-label="Cerca titolo" />
          </div>

          <div className="kpis">
            <Kpi label="Movimenti" value={String(list.length)} />
            <Kpi label="Plus del periodo" value={eur(totals.plus, true)} className={tone(totals.plus)} />
            <Kpi label="Minus del periodo" value={eur(totals.minus, true)} className={tone(totals.minus)} />
            <Kpi label="Imposta stimata" value={eur(totals.tax)} hint="dal cassetto fiscale, minus compensate" />
          </div>
          {list.length > 0 && (
            <div className="export-btns">
              <span className="muted small">Esporta</span>
              <button type="button" className="btn btn-ghost btn-small" onClick={() => void exportPdf(exportData())}>PDF</button>
              <button type="button" className="btn btn-ghost btn-small" onClick={() => void exportXlsx(exportData())}>Excel</button>
            </div>
          )}

          {list.length === 0 ? (
            <div className="card muted">Nessun movimento in questo periodo.</div>
          ) : (
            <>
              <ul className="mov-list">
                {list.map(m => <MovementItem key={m.key} m={m} actions={actions(m)} margin={marginAt(m)} tax={taxOf.get(m.key)} />)}
              </ul>
              <table className="pos-table mov-table">
                <thead>
                  <tr>
                    <th>Data</th><th>Titolo</th><th>Tipo</th><th className="num">Quantità</th><th className="num">Prezzo</th>
                    <th className="num">Controvalore</th><th className="num">Commissioni</th><th className="num">Plus/minus</th><th className="num">Imposta</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {list.map(m => (
                    <tr key={m.key}>
                      <td className="nowrap">{fmtDate(m.date)}</td>
                      <td><b>{m.symbol}</b></td>
                      <td><Tag tone={KIND_TONE[m.kind]}>{KIND_LABEL[m.kind]}</Tag>{m.estimated && <span className="badge badge-warn" title="Prezzo di chiusura di borsa: modifica il movimento per inserire quello vero">da confermare</span>}{m.marginAmount > 0 && <span className="badge badge-warn" title="Finanziato a margine">margine {money(m.marginAmount, m.currency)}</span>}<MarginDayNote margin={marginAt(m)} /></td>
                      <td className="num">{qty(m.qty)}</td>
                      <td className="num">{money(m.price, m.currency)}</td>
                      <td className="num">{money(m.gross, m.currency)}</td>
                      <td className="num">{m.commission ? money(m.commission, m.commissionCurrency) : '—'}</td>
                      <td className={`num ${tone(m.gainEur)}`}>{m.gainEur === null ? '' : eur(m.gainEur, true)}</td>
                      <td className="num">{taxOf.has(m.key) ? eur(taxOf.get(m.key)!) : ''}</td>
                      <td>{actions(m, true)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={7}>Totale del periodo · plus {eur(totals.plus)} · minus {eur(totals.minus)}</td>
                    <td className={`num ${tone(totals.net)}`}>{eur(totals.net, true)}</td>
                    <td className="num">{eur(totals.tax)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </>
          )}
        </>
      ) : tab === 'cash' ? (
        <div className="card">
          <h2>Dividendi, interessi e commissioni</h2>
          {cash.items.length === 0 ? (
            <p className="muted">Nessun movimento di cassa nel periodo. Arrivano dalla sincronizzazione IBKR.</p>
          ) : (
            <>
              <div className="kpis">
                {cashEur.byKind.map(k => <Kpi key={k.kind} label={CASH_LABEL[k.kind] ?? k.kind} value={eur(k.eur, true)} className={tone(k.eur)} />)}
                <Kpi label="Saldo netto" value={eur(cashEur.netEur, true)} className={tone(cashEur.netEur)} hint={cashEur.missing ? `${cashEur.missing} senza cambio, esclusi` : 'in euro, al cambio del giorno'} />
              </div>
              <ul className="plain-list">
                {cash.totals.map(t => (
                  <li key={t.kind + t.currency}>
                    <span>{CASH_LABEL[t.kind] ?? t.kind} · totale</span>
                    <b className={tone(t.amount)}>{money(t.amount, t.currency)}</b>
                  </li>
                ))}
              </ul>
              <ul className="plain-list">
                {cash.items.map(r => (
                  <li key={r.id} title={r.description}>
                    <span>{fmtDate(r.date)} · {r.kind === 'dividend' ? <Tag tone="dividend">{CASH_LABEL[r.kind]}</Tag> : CASH_LABEL[r.kind] ?? r.kind}{r.symbol ? ` · ${r.symbol}` : ''}</span>
                    <b className={tone(r.amount)}>{money(r.amount, r.currency)}</b>
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="muted small">Elenco nella valuta originale; i totali in euro usano il cambio del giorno salvato da IBKR (o quello di oggi se manca). Per il fisco vedi Fiscale → Prospetto per la dichiarazione.</p>
        </div>
      ) : (
        <div className="card">
          <h2>Interessi sul margine</h2>
          <InterestList pid={c.selectedId} rows={interest} />
        </div>
      )}
    </section>
  )
}

/** Margine in uso nel giorno dell'acquisto (dallo storico giornaliero IBKR). */
function MarginDayNote({ margin }: { margin: MarginOnDate | null }) {
  if (!margin) return null
  const text = margin.debts.length
    ? `conto a margine: ${margin.debts.map(d => money(-d.principal, d.currency)).join(' + ')}`
    : 'conto senza margine'
  return <span className="muted small margin-day" title={`Dato IBKR del ${margin.date}`}>{text}</span>
}

function MovementItem({ m, actions, margin, tax }: { m: Movement; actions: React.ReactNode; margin: MarginOnDate | null; tax?: number }) {
  return (
    <li className="card mov-item">
      <div className="mov-head">
        <b>{m.symbol}</b>
        <Tag tone={KIND_TONE[m.kind]}>{KIND_LABEL[m.kind]}</Tag>
        <span className="muted mov-date">{fmtDate(m.date)}</span>
        {m.pac && <span className="badge">PAC</span>}
        {m.estimated && <span className="badge badge-warn" title="Prezzo di chiusura di borsa: modifica il movimento per inserire quello vero">da confermare</span>}
      </div>
      <div className="mov-body">
        <span>{qty(m.qty)} × {money(m.price, m.currency)} = {money(m.gross, m.currency)}</span>
        {m.gainEur !== null && (
          <span className="num">
            <b className={tone(m.gainEur)}>{eur(m.gainEur, true)}</b>
            {tax !== undefined && tax > 0.005 && <small className="muted"> · imposta {eur(tax)}</small>}
          </span>
        )}
      </div>
      {actions}
      <MarginDayNote margin={margin} />
      {(m.commission > 0 || m.marginAmount > 0) && (
        <div className="muted small">
          {m.commission > 0 && <>Commissioni {money(m.commission, m.commissionCurrency)}</>}
          {m.marginAmount > 0 && <> · a margine {money(m.marginAmount, m.currency)}</>}
        </div>
      )}
    </li>
  )
}

/** Interessi di margine del periodo: quelli IBKR arrivano da soli, gli altri si scrivono qui (come nel sito vecchio). */
function InterestList({ pid, rows }: { pid: string; rows: ReturnType<typeof marginInterest> }) {
  const edit = usePortfolioEdit()
  const [f, setF] = useState<InterestForm>({ period: TODAY.slice(0, 7), amount: '', currency: 'USD' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const month = (p: string) => new Date(p + '-15').toLocaleDateString('it-IT', { month: 'long', year: 'numeric' })

  async function add(e: React.FormEvent) {
    e.preventDefault()
    const problem = validateInterest(f, TODAY)
    if (problem) return setError(problem)
    setBusy(true)
    try {
      const row = buildInterest(f, Date.now().toString(36))
      await edit.changeMarginInterest(pid, cur => [...cur, row])
      setF({ ...f, amount: '' })
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Salvataggio non riuscito.')
    } finally {
      setBusy(false)
    }
  }
  async function remove(r: (typeof rows)[number]) {
    if (!confirm(`Eliminare l'interesse di ${month(r.period)} (${money(r.amount, r.currency)})?`)) return
    try {
      await edit.changeMarginInterest(pid, cur => {
        const i = cur.findIndex(x => x && x.id === r.id)
        return i < 0 ? undefined : cur.filter((_, k) => k !== i)
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Eliminazione non riuscita.')
    }
  }

  return (
    <>
      {rows.length === 0 ? (
        <p className="muted">Nessun interesse nel periodo.</p>
      ) : (
        <ul className="plain-list">
          {rows.map(r => (
            <li key={r.id ?? `${r.period}-${r.currency}`}>
              <span>
                {month(r.period)}
                <br />
                <small className="muted">{isManualInterest(r) ? 'inserito a mano' : 'da IBKR'}</small>
              </span>
              <span className="inline-pair">
                <b className="neg">{money(-Math.abs(r.amount), r.currency)}</b>
                {isManualInterest(r) && r.id && (
                  <button type="button" className="linklike neg" onClick={() => void remove(r)}>Elimina</button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      <form className="note-form" onSubmit={add}>
        <h3>Aggiungi un interesse addebitato</h3>
        <div className="form-row">
          <label>Mese<input type="month" value={f.period} max={TODAY.slice(0, 7)} onChange={e => setF({ ...f, period: e.target.value })} /></label>
          <label>Importo
            <span className="inline-pair">
              <input inputMode="decimal" value={f.amount} onChange={e => setF({ ...f, amount: e.target.value })} placeholder="es. 4,52" />
              <select value={f.currency} onChange={e => setF({ ...f, currency: e.target.value })} aria-label="Valuta">
                {['USD', 'EUR', 'CAD', 'GBP', 'CHF'].map(x => <option key={x} value={x}>{x}</option>)}
              </select>
            </span>
          </label>
        </div>
        <p className="auth-error" role="alert">{error}</p>
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Salvo…' : 'Aggiungi'}</button>
        </div>
      </form>
      <p className="muted small">Quelli di IBKR arrivano con la sincronizzazione; se nello stesso mese ce n'è uno a mano, la sincronizzazione lo riconosce.</p>
    </>
  )
}
