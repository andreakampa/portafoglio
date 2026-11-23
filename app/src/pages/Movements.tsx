import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { ExerciseFormCard } from '../components/ExerciseForm'
import { MovementForm, TransferEditCard, TransferFormCard } from '../components/MovementForms'
import { PacPlansCard } from '../components/PacPlansCard'
import { Kpi, PortfolioPicker } from '../components/PortfolioPicker'
import { KIND_TONE, Tag, TagButton } from '../components/Tag'
import { usePortfolioEdit } from '../data/usePortfolioEdit'
import { useComputedPortfolio } from '../data/useComputedPortfolio'
import { usePortfolioState } from '../data/usePortfolioState'
import { findTransfer, type PortfolioLike } from '../domain/txEdit'
import { marginOnDate, type MarginOnDate, type MarginPortfolio } from '../domain/engine/margin'
import { buildMovements, CASH_LABEL, cashflowsIn, cashTotalsEur, KIND_LABEL, marginInterest, periodRange, type Movement, type MovementKind, type Period } from '../domain/engine/movements'
import { eur, money, qty, THIS_YEAR, tone } from '../lib/format'

const TODAY = new Date().toISOString().slice(0, 10)
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
  const [period, setPeriod] = useState<Period>('ytd')
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
  const edit = usePortfolioEdit()
  const state = usePortfolioState()
  const [delError, setDelError] = useState('')

  const all = useMemo(() => (c.status === 'ready' ? buildMovements(c.portfolio, c.result) : []), [c])

  if (c.status === 'loading') return <section className="page"><h1>Movimenti</h1><div className="card skeleton" style={{ height: 240 }} /></section>
  if (c.status === 'error') return <section className="page"><h1>Movimenti</h1><div className="card error">{c.message}</div></section>
  if (c.status === 'empty') return <section className="page"><h1>Movimenti</h1><div className="card">Nessun portafoglio.</div></section>

  const years = [...new Set(all.map(m => m.date.slice(0, 4)))].filter(y => y !== String(THIS_YEAR)).sort().reverse()
  const [from, to] = periodRange(period, TODAY)
  const kinds = FILTERS.find(f => f.key === filter)!.kinds
  const q = search.trim().toUpperCase()
  const list = all.filter(m => m.date >= from && m.date < to && kinds.includes(m.kind) && (!q || m.symbol.toUpperCase().includes(q)))
  const gain = list.reduce((s, m) => s + (m.gainEur ?? 0), 0)
  const editable = (m: Movement) => m.kind === 'buy' || m.kind === 'sell' || m.kind === 'short_sell' || m.kind === 'buy_to_cover'
  const isTransfer = (m: Movement) => m.kind === 'transfer_in' || m.kind === 'transfer_out'
  const portfolios = (state.status === 'ready' ? state.data?.portfolios : undefined) as Record<string, PortfolioLike> | undefined
  const removeTransfer = async (m: Movement) => {
    const t = c.portfolio.assets?.[m.assetId]?.transactions?.[m.index]
    if (!portfolios || !t?.transferId) return setDelError('Trasferimento non trovato: ricarica la pagina e riprova.')
    const pair = findTransfer(portfolios, t.transferId)
    const name = (pid?: string) => c.options.find(o => o.id === pid)?.name ?? 'altro portafoglio'
    const both = pair.out && pair.in ? ` Si eliminano insieme l'uscita da ${name(pair.out.pid)} e l'entrata in ${name(pair.in.pid)}.` : ''
    if (!confirm(`Eliminare il trasferimento di ${m.symbol} del ${fmtDate(m.date)}?${both}`)) return
    setDelError('')
    try {
      await edit.changeTransfer(portfolios, t.transferId, { remove: true })
    } catch (e) {
      setDelError(e instanceof Error ? e.message : 'Eliminazione non riuscita.')
    }
  }
  const remove = async (m: Movement) => {
    if (isTransfer(m)) return removeTransfer(m)
    const warn = m.fromBroker ? ' (È un movimento importato da IBKR: la sincronizzazione potrebbe riportarlo.)' : ''
    if (!confirm(`Eliminare ${KIND_LABEL[m.kind].toLowerCase()} di ${m.symbol} del ${fmtDate(m.date)}?${warn}`)) return
    setDelError('')
    const t = c.portfolio.assets?.[m.assetId]?.transactions?.[m.index]
    try {
      await edit.remove(c.selectedId, m.assetId, { id: m.txId, index: m.index, date: t?.date ?? m.date, type: String(t?.type ?? m.kind) })
    } catch (e) {
      setDelError(e instanceof Error ? e.message : 'Eliminazione non riuscita.')
    }
  }
  const actions = (m: Movement) =>
    editable(m) || isTransfer(m) ? (
      <span className="note-actions">
        <TagButton tone="edit" onClick={() => { setForm(m); window.scrollTo({ top: 0, behavior: 'smooth' }) }}>Modifica</TagButton>
        <TagButton tone="delete" onClick={() => void remove(m)}>Elimina</TagButton>
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
          <button key={p.key} type="button" role="tab" aria-selected={period === p.key} className={`pill small-pill ${period === p.key ? 'active' : ''}`} onClick={() => setPeriod(p.key)}>
            {p.label}
          </button>
        ))}
      </div>

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
            <Kpi label="Plus/minus del periodo" value={eur(gain, true)} className={tone(gain)} hint="vendite e chiusure short" />
          </div>

          {list.length === 0 ? (
            <div className="card muted">Nessun movimento in questo periodo.</div>
          ) : (
            <>
              <ul className="mov-list">
                {list.map(m => <MovementItem key={m.key} m={m} actions={actions(m)} margin={marginAt(m)} />)}
              </ul>
              <table className="pos-table mov-table">
                <thead>
                  <tr>
                    <th>Data</th><th>Titolo</th><th>Tipo</th><th className="num">Quantità</th><th className="num">Prezzo</th>
                    <th className="num">Controvalore</th><th className="num">Commissioni</th><th className="num">Plus/minus</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {list.map(m => (
                    <tr key={m.key}>
                      <td>{fmtDate(m.date)}</td>
                      <td><b>{m.symbol}</b></td>
                      <td><Tag tone={KIND_TONE[m.kind]}>{KIND_LABEL[m.kind]}</Tag>{m.estimated && <span className="badge badge-warn" title="Prezzo di chiusura di borsa: modifica il movimento per inserire quello vero">da confermare</span>}{m.marginAmount > 0 && <span className="badge badge-warn" title="Finanziato a margine">margine {money(m.marginAmount, m.currency)}</span>}<MarginDayNote margin={marginAt(m)} /></td>
                      <td className="num">{qty(m.qty)}</td>
                      <td className="num">{money(m.price, m.currency)}</td>
                      <td className="num">{money(m.gross, m.currency)}</td>
                      <td className="num">{m.commission ? money(m.commission, m.commissionCurrency) : '—'}</td>
                      <td className={`num ${tone(m.gainEur)}`}>{m.gainEur === null ? '' : eur(m.gainEur, true)}</td>
                      <td>{actions(m)}</td>
                    </tr>
                  ))}
                </tbody>
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
          {interest.length === 0 ? (
            <p className="muted">Nessun interesse nel periodo. Gli importi arrivano dall'import IBKR o si inseriscono nel sito attuale.</p>
          ) : (
            <ul className="plain-list">
              {interest.map(r => (
                <li key={r.id ?? `${r.period}-${r.currency}`}>
                  <span>{new Date(r.period + '-15').toLocaleDateString('it-IT', { month: 'long', year: 'numeric' })}</span>
                  <b className="neg">{money(-Math.abs(r.amount), r.currency)}</b>
                </li>
              ))}
            </ul>
          )}
          <p className="muted small">Il calcolo automatico per posizione, con il tasso IBKR giornaliero, arriverà con la gestione del margine.</p>
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

function MovementItem({ m, actions, margin }: { m: Movement; actions: React.ReactNode; margin: MarginOnDate | null }) {
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
        {m.gainEur !== null && <b className={tone(m.gainEur)}>{eur(m.gainEur, true)}</b>}
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
