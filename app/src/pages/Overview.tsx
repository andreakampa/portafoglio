import { Link } from 'react-router'
import { IbkrSyncNotice } from '../components/IbkrSyncNotice'
import { MarginCard } from '../components/MarginCard'
import { HistoryCard, IndicesCard } from '../components/MarketCards'
import { WelcomeCard } from '../components/PortfolioAdmin'
import { Kpi, PortfolioPicker } from '../components/PortfolioPicker'
import { WatchlistSummary } from '../components/WatchlistSummary'
import { useComputedPortfolio } from '../data/useComputedPortfolio'
import { usePortfolioState } from '../data/usePortfolioState'
import { overviewKpis, topPositions } from '../domain/overview'
import { summarizePortfolios } from '../domain/portfolioState'
import { eur, money, pct, qty, THIS_YEAR, tone } from '../lib/format'
import { Tag } from '../components/Tag'

type Ready = Extract<ReturnType<typeof useComputedPortfolio>, { status: 'ready' }>

/**
 * PC: numeri chiave in alto, poi due colonne (andamento e posizioni | mercati, watchlist, margine).
 * Telefono: una colonna, nello stesso ordine di importanza. Il CSS (.overview-*) decide.
 */
export function Overview() {
  const state = usePortfolioState()
  const c = useComputedPortfolio()
  const empty = state.status === 'ready' && summarizePortfolios(state.data).length === 0

  return (
    <section className="page">
      <header className="page-head overview-head">
        <h1>Panoramica</h1>
        {c.status === 'ready' && <PortfolioPicker options={c.options} selectedId={c.selectedId} onSelect={c.select} />}
        {c.status === 'ready' && <Link className="btn btn-primary overview-add" to="/movimenti" state={{ nuovo: true }}>+ Movimento</Link>}
      </header>

      {state.status === 'loading' && <div className="card skeleton" aria-busy="true" style={{ height: 120 }} />}
      {state.status === 'error' && <div className="card error">Non riesco a leggere i dati: {state.message}</div>}
      <IbkrSyncNotice />
      {empty && <WelcomeCard />}

      {c.status === 'ready' && <KpiRow c={c} />}

      <div className="overview-grid">
        <div className="overview-main">
          {c.status === 'ready' && <HistoryCard portfolio={c.portfolio} />}
          {c.status === 'ready' && <TopPositions c={c} />}
        </div>
        <div className="overview-side">
          <IndicesCard />
          <WatchlistSummary />
          {c.status === 'ready' && <MarginCard c={c} />}
        </div>
      </div>
    </section>
  )
}

function KpiRow({ c }: { c: Ready }) {
  const k = overviewKpis(c.rows, c.totals, c.result.fiscal.lines, THIS_YEAR)
  const dichiarativo = c.result.regime === 'dichiarativo'
  return (
    <div className="kpis overview-kpis">
      <Kpi label="Valore" value={eur(k.valueEur)} hint={`${eur(k.dayEur, true)} oggi${k.dayPct == null ? '' : ` (${pct(k.dayPct)})`}`} />
      <Kpi label="Risultato non realizzato" value={eur(k.unrealizedEur, true)} className={tone(k.unrealizedEur)} hint={`su ${eur(k.investedEur)} investiti`} />
      <Kpi label={`Realizzato ${THIS_YEAR}`} value={eur(k.realizedYearEur, true)} className={tone(k.realizedYearEur)} hint="plus meno minus dell'anno" />
      <Kpi label={dichiarativo ? `Imposta da versare ${THIS_YEAR}` : `Imposta trattenuta ${THIS_YEAR}`} value={eur(k.taxYearEur)} hint="stima sulle vendite dell'anno" />
    </div>
  )
}

function TopPositions({ c }: { c: Ready }) {
  const top = topPositions(c.rows)
  const open = c.rows.filter(r => Math.abs(r.qty) > 1e-9).length
  if (!top.length) return null
  return (
    <div className="card">
      <div className="row-head">
        <h2>Posizioni principali</h2>
        <Link to="/posizioni">Tutte ({open})</Link>
      </div>
      <ul className="top-list">
        {top.map(r => (
          <li key={r.assetId}>
            <span><b>{r.symbol}</b>{r.isShort && <Tag tone="short">short</Tag>}<br /><small className="muted">{qty(Math.abs(r.qty))} × {money(r.price, r.currency)}</small></span>
            <span className="num">{eur(r.valueEur)}<br /><small className={tone(r.unrealizedPct)}>{r.unrealizedPct == null ? '' : pct(r.unrealizedPct)}</small></span>
          </li>
        ))}
      </ul>
    </div>
  )
}
