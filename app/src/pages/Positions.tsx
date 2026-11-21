import { useState } from 'react'
import { Issues } from '../components/Issues'
import { MarginCard } from '../components/MarginCard'
import { Kpi, PortfolioPicker } from '../components/PortfolioPicker'
import { useComputedPortfolio } from '../data/useComputedPortfolio'
import type { PositionRow } from '../domain/engine/valuation'
import { eur, money, pct, qty, THIS_YEAR, tone } from '../lib/format'

type SortKey = 'value' | 'pnl' | 'pnlPct' | 'day' | 'name'
const SORTS: { key: SortKey; label: string }[] = [
  { key: 'value', label: 'Valore' },
  { key: 'pnl', label: 'Risultato €' },
  { key: 'pnlPct', label: 'Risultato %' },
  { key: 'day', label: 'Oggi' },
  { key: 'name', label: 'Nome' },
]

function sortRows(rows: PositionRow[], key: SortKey) {
  const v = (r: PositionRow) =>
    key === 'value' ? Math.abs(r.valueEur ?? -Infinity) : key === 'pnl' ? r.unrealizedEur : key === 'pnlPct' ? r.unrealizedPct : r.dayChangePct
  return [...rows].sort((a, b) => (key === 'name' ? a.symbol.localeCompare(b.symbol) : (v(b) ?? -Infinity) - (v(a) ?? -Infinity)))
}

export function Positions() {
  const c = useComputedPortfolio()
  const [sort, setSort] = useState<SortKey>('value')
  const [showClosed, setShowClosed] = useState(false)

  if (c.status === 'loading') return <section className="page"><h1>Posizioni</h1><div className="card skeleton" style={{ height: 240 }} /></section>
  if (c.status === 'error') return <section className="page"><h1>Posizioni</h1><div className="card error">{c.message}</div></section>
  if (c.status === 'empty') return <section className="page"><h1>Posizioni</h1><div className="card">Nessun portafoglio.</div></section>

  const open = sortRows(c.rows.filter(r => r.qty !== 0), sort)
  const closed = c.rows.filter(r => r.qty === 0 && Math.abs(r.realizedEur) > 0.005).sort((a, b) => b.realizedEur - a.realizedEur)
  const t = c.totals
  const currentYear = THIS_YEAR
  const realizedYear = c.result.fiscal.lines.filter(l => l.year === currentYear && l.side !== 'manuale').reduce((s, l) => s + l.gainEur, 0)

  return (
    <section className="page">
      <header className="page-head">
        <h1>Posizioni</h1>
        <PortfolioPicker options={c.options} selectedId={c.selectedId} onSelect={c.select} />
      </header>

      <div className="kpis">
        <Kpi label="Valore" value={eur(t.valueEur)} hint={c.pricesLoading ? 'aggiorno i prezzi…' : undefined} />
        <Kpi label="Investito" value={eur(t.investedEur)} />
        <Kpi label="Non realizzato" value={eur(t.unrealizedEur, true)} className={tone(t.unrealizedEur)} hint={t.investedEur > 0 ? pct((t.unrealizedEur / t.investedEur) * 100) : undefined} />
        <Kpi label={`Realizzato ${currentYear}`} value={eur(realizedYear, true)} className={tone(realizedYear)} hint="lordo, prima delle tasse" />
      </div>
      {t.missingPrices > 0 && <p className="muted small">{t.missingPrices} titoli senza prezzo aggiornato: esclusi dai totali.</p>}

      <MarginCard c={c} />

      <Issues result={c.result} portfolio={c.portfolio} />

      <div className="toolbar">
        <label className="inline">
          Ordina per
          <select value={sort} onChange={e => setSort(e.target.value as SortKey)}>
            {SORTS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </label>
      </div>

      {/* Telefono: schede. PC: tabella. Nessuno scorrimento laterale. */}
      <ul className="pos-cards">
        {open.map(r => <PositionCard key={r.assetId} r={r} />)}
      </ul>
      <table className="pos-table">
        <thead>
          <tr>
            <th>Titolo</th><th className="num">Quantità</th><th className="num">PMC</th><th className="num">Prezzo</th>
            <th className="num">Oggi</th><th className="num">Valore</th><th className="num">Risultato</th>
          </tr>
        </thead>
        <tbody>
          {open.map(r => (
            <tr key={r.assetId}>
              <td><b>{r.symbol}</b>{r.isShort && <span className="badge">short</span>}</td>
              <td className="num">{qty(r.qty)}</td>
              <td className="num">{money(r.pmcNative, r.currency)}</td>
              <td className="num">{money(r.price, r.currency)}</td>
              <td className={`num ${tone(r.dayChangePct)}`}>{pct(r.dayChangePct)}</td>
              <td className="num">{eur(r.valueEur)}</td>
              <td className={`num ${tone(r.unrealizedEur)}`}>{eur(r.unrealizedEur, true)}<br /><small>{pct(r.unrealizedPct)}</small></td>
            </tr>
          ))}
        </tbody>
      </table>

      {closed.length > 0 && (
        <div className="card">
          <button type="button" className="linklike" onClick={() => setShowClosed(v => !v)} aria-expanded={showClosed}>
            {showClosed ? '▾' : '▸'} Posizioni chiuse ({closed.length})
          </button>
          {showClosed && (
            <ul className="plain-list">
              {closed.map(r => (
                <li key={r.assetId}>
                  <span>{r.symbol}</span>
                  <span className={tone(r.realizedEur)}>{eur(r.realizedEur, true)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}

function PositionCard({ r }: { r: PositionRow }) {
  return (
    <li className="card pos-card">
      <div className="pos-card-head">
        <b>{r.symbol}</b>
        {r.isShort && <span className="badge">short</span>}
        <span className={`pos-day ${tone(r.dayChangePct)}`}>{pct(r.dayChangePct)}</span>
      </div>
      <div className="pos-card-main">
        <span className="pos-value">{eur(r.valueEur)}</span>
        <span className={tone(r.unrealizedEur)}>{eur(r.unrealizedEur, true)} · {pct(r.unrealizedPct)}</span>
      </div>
      <div className="pos-card-meta muted">
        {qty(r.qty)} × {money(r.price, r.currency)} · PMC {money(r.pmcNative, r.currency)}
      </div>
    </li>
  )
}
