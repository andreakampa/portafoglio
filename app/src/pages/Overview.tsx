import { IbkrSyncNotice } from '../components/IbkrSyncNotice'
import { MarginCard } from '../components/MarginCard'
import { HistoryCard, IndicesCard } from '../components/MarketCards'
import { PortfolioPicker } from '../components/PortfolioPicker'
import { WatchlistSummary } from '../components/WatchlistSummary'
import { WelcomeCard } from '../components/PortfolioAdmin'
import { useComputedPortfolio } from '../data/useComputedPortfolio'
import { usePortfolioState } from '../data/usePortfolioState'
import { summarizePortfolios } from '../domain/portfolioState'

export function Overview() {
  const state = usePortfolioState()
  const c = useComputedPortfolio()

  return (
    <section className="page">
      <header className="page-head">
        <h1>Panoramica</h1>
        {c.status === 'ready' && <PortfolioPicker options={c.options} selectedId={c.selectedId} onSelect={c.select} />}
      </header>

      {state.status === 'loading' && <div className="card skeleton" aria-busy="true" style={{ height: 120 }} />}
      {state.status === 'error' && (
        <div className="card error">Non riesco a leggere i dati: {state.message}</div>
      )}
      <IbkrSyncNotice />
      <IndicesCard />
      <WatchlistSummary />
      {c.status === 'ready' && <HistoryCard portfolio={c.portfolio} />}
      {c.status === 'ready' && <MarginCard c={c} />}
      {state.status === 'ready' && <PortfolioList data={state.data} />}

      <a className="btn btn-ghost" href="/portafoglio/">
        Apri il sito attuale
      </a>
    </section>
  )
}

function PortfolioList({ data }: { data: Parameters<typeof summarizePortfolios>[0] }) {
  const list = summarizePortfolios(data)
  if (!list.length) return <WelcomeCard />

  return (
    <div className="grid">
      {list.map(p => (
        <article key={p.id} className="card portfolio-card">
          <div className="portfolio-card-head">
            <h2>{p.name}</h2>
            {p.active && <span className="badge">attivo</span>}
          </div>
          <p className="muted">Regime {p.taxRegime}</p>
          <dl className="stats">
            <div>
              <dt>Titoli</dt>
              <dd>{p.assets}</dd>
            </div>
            <div>
              <dt>Movimenti</dt>
              <dd>{p.transactions}</dd>
            </div>
          </dl>
        </article>
      ))}
    </div>
  )
}
