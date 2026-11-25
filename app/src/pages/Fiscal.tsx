import { useState } from 'react'
import { Link } from 'react-router'
import { DividendsCard } from '../components/DividendsCard'
import { Issues } from '../components/Issues'
import { ManualLossEditor, removeManualLossAsk } from '../components/ManualLossEditor'
import { Kpi, PortfolioPicker } from '../components/PortfolioPicker'
import { useComputedPortfolio } from '../data/useComputedPortfolio'
import { availableLosses, YEARS_CARRY_FORWARD, type FiscalLine } from '../domain/engine/fiscal'
import { usePortfolioEdit } from '../data/usePortfolioEdit'
import { daysToExpiry, type StoredManualLoss } from '../domain/manualLosses'
import { localToday } from '../lib/today'
import { wealthTax, wealthTaxKindFor } from '../domain/engine/wealthTax'
import { eur, money, qty, THIS_YEAR, tone } from '../lib/format'
import { FiscalLineDetail } from '../components/FiscalLineDetail'
import { Tag, TagButton } from '../components/Tag'

export function Fiscal() {
  const c = useComputedPortfolio()
  const currentYear = THIS_YEAR
  const [pickedYear, setYear] = useState<number | null>(null)
  // Minus a mano: null = nessun modulo aperto, 'new' = nuova, numero = posizione di quella da modificare.
  const [lossForm, setLossForm] = useState<'new' | number | null>(null)
  const [lossError, setLossError] = useState('')
  const edit = usePortfolioEdit()

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
  const taxable = lines.reduce((s, l) => s + l.taxableEur, 0)
  const manual = ((c.portfolio as { fiscal?: { manualLosses?: StoredManualLoss[] } }).fiscal?.manualLosses ?? []).filter(Boolean)
  const byKey = new Map(fiscal.lines.map(l => [l.key, l]))
  const today = localToday()
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
        <Kpi label="Imponibile netto" value={eur(taxable)} hint="plus meno minus usate" />
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
                    {b.expiresYear === currentYear
                      ? `scadono il 31/12/${b.expiresYear}, tra ${daysToExpiry(b.expiresYear, today)} giorni`
                      : `usabili fino al 31/12/${b.expiresYear}`}
                  </small>
                  <span className="loss-bar" title={`usate ${eur(b.originalEur - b.remainingEur)} su ${eur(b.originalEur)}`}>
                    <span style={{ width: `${Math.min(100, (b.remainingEur / b.originalEur) * 100)}%` }} />
                  </span>
                </span>
                <span className="num">
                  <b>{eur(b.remainingEur)}</b>
                  <br />
                  <small className="muted">di {eur(b.originalEur)}</small>
                </span>
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
        {lines.some(l => l.detail) && <p className="muted small">Tocca una riga per vedere come si arriva alla plus o alla minus: vendita, acquisti chiusi, cambio, commissioni e tasse.</p>}
        {lines.length === 0 ? (
          <p className="muted">Nessuna vendita né minus a mano nel {year}.</p>
        ) : (
          <ul className="fiscal-lines">
            {lines.map(l => {
              const row = (
                <>
                  <div>
                    <b>{l.assetName}</b>
                    {l.side === 'short' && <Tag tone="short">short</Tag>}
                    {l.side === 'manuale' && <span className="badge">minus a mano</span>}
                    {l.excluded && <span className="badge">ETF/fondo: non compensabile</span>}
                    <br />
                    <small className="muted">
                      {new Date(l.date + 'T12:00:00').toLocaleDateString('it-IT')}
                      {l.qty != null && l.detail && <> · {l.side === 'short' ? 'ricoperte' : 'vendute'} {qty(l.qty)} a {money(l.detail.price, l.detail.currency)}</>}
                    </small>
                  </div>
                  <div className="num">
                    <span className={tone(l.gainEur)}>{eur(l.gainEur, true)}</span>
                    {l.compensatedEur > 0.005 && <small className="muted">minus usate {eur(l.compensatedEur)}</small>}
                    {l.taxEur > 0.005 && <small className="muted">imposta {eur(l.taxEur)}</small>}
                  </div>
                </>
              )
              const stored = l.manualIndex != null ? manual[l.manualIndex] : undefined
              if (stored && lossForm === l.manualIndex) {
                return (
                  <li key={l.key}>
                    <ManualLossEditor pid={c.selectedId} editing={{ index: l.manualIndex!, loss: stored }} onDone={() => setLossForm(null)} />
                  </li>
                )
              }
              // Con il dettaglio: si apre con un clic e mostra come si arriva alla plus o minus.
              return (
                <li key={l.key}>
                  {l.detail ? (
                    <details className="fiscal-line">
                      <summary title="Mostra come si arriva a questo risultato">{row}</summary>
                      <FiscalLineDetail l={l} />
                    </details>
                  ) : (
                    <div className="fiscal-line-plain">{row}</div>
                  )}
                  <LossUsage l={l} byKey={byKey} currentYear={currentYear} />
                  {stored && (
                    <div className="note-actions fiscal-line-actions">
                      <TagButton tone="edit" title={`Modifica la minus ${l.assetName}`} onClick={() => { setLossError(''); setLossForm(l.manualIndex!) }}>
                        Modifica
                      </TagButton>
                      <TagButton
                        tone="delete"
                        title={`Elimina la minus ${l.assetName}`}
                        onClick={() => {
                          setLossError('')
                          removeManualLossAsk(edit, c.selectedId, l.manualIndex!, stored).catch(err => setLossError(err instanceof Error ? err.message : 'Eliminazione non riuscita.'))
                        }}
                      >
                        Elimina
                      </TagButton>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
        {lossError && <p className="auth-error" role="alert">{lossError}</p>}
        {lossForm === 'new' ? (
          <ManualLossEditor pid={c.selectedId} onDone={() => setLossForm(null)} />
        ) : (
          <button type="button" className="btn btn-ghost" onClick={() => { setLossError(''); setLossForm('new') }}>+ Minus a mano</button>
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

const shortDate = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('it-IT')

/** Sotto una minus: su quali plus è stata usata e quanto resta. Sotto una plus: da quali minus viene la compensazione. */
function LossUsage({ l, byKey, currentYear }: { l: FiscalLine; byKey: Map<string, FiscalLine>; currentYear: number }) {
  const name = (key: string) => byKey.get(key)?.assetName ?? '?'
  const date = (key: string) => {
    const d = byKey.get(key)?.date
    return d ? shortDate(d) : ''
  }
  if (l.usedFrom?.length) {
    return (
      <ul className="loss-usage muted small">
        {l.usedFrom.map(u => (
          <li key={u.key}>
            minus usata {eur(u.eur)} da {name(u.key)} ({date(u.key)})
          </li>
        ))}
      </ul>
    )
  }
  if (l.lossLeftEur == null) return null
  const expired = l.year + YEARS_CARRY_FORWARD < currentYear
  return (
    <ul className="loss-usage muted small">
      {(l.usedBy ?? []).map(u => (
        <li key={u.key}>
          usata {eur(u.eur)} su {name(u.key)} il {date(u.key)}
        </li>
      ))}
      <li>
        {l.lossLeftEur <= 0.005
          ? <b>usata tutta</b>
          : expired
            ? <>{eur(l.lossLeftEur)} non usati: scaduta il 31/12/{l.year + YEARS_CARRY_FORWARD}</>
            : <>da usare ancora: <b>{eur(l.lossLeftEur)}</b> (entro il 31/12/{l.year + YEARS_CARRY_FORWARD})</>}
      </li>
    </ul>
  )
}
