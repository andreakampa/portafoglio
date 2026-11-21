import { useState } from 'react'
import { Link } from 'react-router'
import { DividendsCard } from '../components/DividendsCard'
import { Issues } from '../components/Issues'
import { Kpi, PortfolioPicker } from '../components/PortfolioPicker'
import { useComputedPortfolio } from '../data/useComputedPortfolio'
import { availableLosses } from '../domain/engine/fiscal'
import { wealthTax, wealthTaxKindFor } from '../domain/engine/wealthTax'
import { eur, THIS_YEAR, tone } from '../lib/format'

export function Fiscal() {
  const c = useComputedPortfolio()
  const currentYear = THIS_YEAR
  const [pickedYear, setYear] = useState<number | null>(null)

  if (c.status === 'loading') return <section className="page"><h1>Fiscale</h1><div className="card skeleton" style={{ height: 240 }} /></section>
  if (c.status === 'error') return <section className="page"><h1>Fiscale</h1><div className="card error">{c.message}</div></section>
  if (c.status === 'empty') return <section className="page"><h1>Fiscale</h1><div className="card">Nessun portafoglio.</div></section>

  const { fiscal } = c.result
  const years = [...new Set([currentYear, ...fiscal.lines.map(l => l.year)])].sort((a, b) => b - a)
  const year = pickedYear && years.includes(pickedYear) ? pickedYear : years[0]!
  const lines = fiscal.lines.filter(l => l.year === year).sort((a, b) => b.date.localeCompare(a.date))
  const plus = lines.filter(l => l.gainEur > 0).reduce((s, l) => s + l.gainEur, 0)
  const minus = -lines.filter(l => l.gainEur < 0).reduce((s, l) => s + l.gainEur, 0)
  const compensated = lines.reduce((s, l) => s + l.compensatedEur, 0)
  const tax = lines.reduce((s, l) => s + l.taxEur, 0)
  const open = fiscal.buckets.filter(b => b.remainingEur > 0.005 && b.expiresYear >= currentYear)
  const kind = wealthTaxKindFor(c.result.regime)
  const regimeNote =
    c.result.regime === 'dichiarativo'
      ? 'Dichiarativo: le tasse si versano con la dichiarazione. Plus e minus dello stesso anno si compensano tutte.'
      : 'Amministrato: la banca trattiene le tasse a ogni vendita. Una minus compensa solo le plus successive.'

  return (
    <section className="page">
      <header className="page-head">
        <h1>Fiscale</h1>
        <PortfolioPicker options={c.options} selectedId={c.selectedId} onSelect={c.select} />
        <p className="muted small">{regimeNote}</p>
      </header>

      {c.result.regime === 'dichiarativo' && (
        <Link to="/fiscale/dichiarazione" className="btn btn-primary fiscal-link">Prospetto per la dichiarazione (RT, RM, RW)</Link>
      )}

      <div className="pills" role="tablist" aria-label="Anno">
        {years.map(y => (
          <button key={y} type="button" role="tab" aria-selected={y === year} className={`pill ${y === year ? 'active' : ''}`} onClick={() => setYear(y)}>
            {y}
          </button>
        ))}
      </div>

      <div className="kpis">
        <Kpi label="Plus realizzate" value={eur(plus)} className={tone(plus)} />
        <Kpi label="Minus realizzate" value={eur(-minus)} className={tone(-minus)} />
        <Kpi label="Minus usate" value={eur(compensated)} />
        <Kpi label={c.result.regime === 'dichiarativo' ? 'Imposta da versare' : 'Imposta trattenuta'} value={eur(tax)} hint="stima: 26%, 12,5% titoli di Stato, 33% crypto" />
      </div>

      <div className="card">
        <h2>Minus disponibili</h2>
        {open.length === 0 ? (
          <p className="muted">Nessuna minus da usare.</p>
        ) : (
          <ul className="plain-list">
            {open.map(b => (
              <li key={`${b.category}-${b.year}`}>
                <span>
                  Realizzate nel {b.year}{b.category === 'crypto' ? ' (crypto)' : ''}
                  <br />
                  <small className={b.expiresYear === currentYear ? 'neg' : 'muted'}>
                    {b.expiresYear === currentYear ? `scadono il 31/12/${b.expiresYear}` : `usabili fino al ${b.expiresYear}`}
                  </small>
                </span>
                <b>{eur(b.remainingEur)}</b>
              </li>
            ))}
            <li>
              <span>Totale usabile nel {currentYear}</span>
              <b>{eur(availableLosses(fiscal, currentYear))}</b>
            </li>
          </ul>
        )}
      </div>

      <div className="card">
        <h2>Movimenti {year}</h2>
        {lines.length === 0 ? (
          <p className="muted">Nessuna vendita nel {year}.</p>
        ) : (
          <ul className="fiscal-lines">
            {lines.map(l => (
              <li key={l.key}>
                <div>
                  <b>{l.assetName}</b>
                  {l.side === 'short' && <span className="badge">short</span>}
                  {l.side === 'manuale' && <span className="badge">a mano</span>}
                  {l.excluded && <span className="badge">ETF/fondo: non compensabile</span>}
                  <br />
                  <small className="muted">{new Date(l.date + 'T12:00:00').toLocaleDateString('it-IT')}</small>
                </div>
                <div className="num">
                  <span className={tone(l.gainEur)}>{eur(l.gainEur, true)}</span>
                  {l.compensatedEur > 0.005 && <small className="muted">minus usate {eur(l.compensatedEur)}</small>}
                  {l.taxEur > 0.005 && <small className="muted">imposta {eur(l.taxEur)}</small>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <DividendsCard
        portfolio={c.portfolio}
        fx={c.fx}
        regime={c.result.regime}
        year={year}
        currentYear={currentYear}
        gainsTaxEur={tax}
        valueEur={Math.max(0, c.totals.investedEur + c.totals.unrealizedEur)}
      />

      <div className="card">
        <h2>{kind === 'ivafe' ? 'IVAFE' : 'Imposta di bollo'} {currentYear}</h2>
        <p>
          Stima: <b>{eur(wealthTax({ kind, valueEur: Math.max(0, c.totals.investedEur + c.totals.unrealizedEur) }))}</b>{' '}
          <span className="muted">(2 per mille sul valore attuale; il valore vero è quello al 31/12)</span>
        </p>
        <p className="muted small">
          {kind === 'ivafe'
            ? 'Broker estero: si paga con la dichiarazione dei redditi, insieme al quadro RW.'
            : 'Banca italiana: la trattiene direttamente l’intermediario.'}
        </p>
      </div>

      <Issues result={c.result} portfolio={c.portfolio} />
      <p className="muted small">Calcoli indicativi secondo le regole in docs/regole-fiscali.md: non sostituiscono il commercialista.</p>
    </section>
  )
}
