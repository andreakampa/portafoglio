import { useState } from 'react'
import { Issues } from '../components/Issues'
import { MarginCard } from '../components/MarginCard'
import { PositionsKpiGroups } from '../components/PositionsKpiGroups'
import { PriceBar } from '../components/PriceBar'
import { PortfolioPicker } from '../components/PortfolioPicker'
import { Tag } from '../components/Tag'
import { useAllPortfoliosValue } from '../data/useAllPortfoliosValue'
import { useComputedPortfolio } from '../data/useComputedPortfolio'
import { useViewPref } from '../data/viewPrefs'
import { grossValueEur, toDisplay, weights, type DisplayCurrency, type WeightBase } from '../domain/display'
import { availableLosses } from '../domain/engine/fiscal'
import type { PositionRow } from '../domain/engine/valuation'
import { cash, money, pct, qty, THIS_YEAR, tone } from '../lib/format'

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
  const [currency, setCurrency] = useViewPref<DisplayCurrency>('currency', ['EUR', 'USD'], 'EUR')
  const [weightBase, setWeightBase] = useViewPref<WeightBase>('weightBase', ['portfolio', 'all'], 'portfolio')
  const ready = c.status === 'ready'
  const allValue = useAllPortfoliosValue(ready && weightBase === 'all', ready ? c.portfolios : NONE, ready ? c.allResults : NONE, ready ? c.latestFx : NONE)

  if (c.status === 'loading') return <section className="page"><h1>Posizioni</h1><div className="card skeleton" style={{ height: 240 }} /></section>
  if (c.status === 'error') return <section className="page"><h1>Posizioni</h1><div className="card error">{c.message}</div></section>
  if (c.status === 'empty') return <section className="page"><h1>Posizioni</h1><div className="card">Nessun portafoglio.</div></section>

  const open = sortRows(c.rows.filter(r => r.qty !== 0), sort)
  const closed = c.rows.filter(r => r.qty === 0 && Math.abs(r.realizedEur) > 0.005).sort((a, b) => b.realizedEur - a.realizedEur)
  const t = c.totals
  const currentYear = THIS_YEAR
  // Importi della tabella nella valuta scelta (cambio di mercato di oggi); i riquadri restano in euro.
  const usdRate = c.eurUsd?.rate ?? c.latestFx.USD ?? null
  const shown = (x: number | null, signed = false) => cash(toDisplay(x, currency, usdRate), currency, signed)
  const weightOf = weights(open, weightBase === 'all' ? allValue ?? 0 : grossValueEur(open))
  const weightText = (id: string) => (weightOf[id] === undefined ? '—' : `${weightOf[id].toFixed(1).replace('.', ',')}%`)

  return (
    <section className="page">
      <header className="page-head">
        <h1>Posizioni</h1>
        <PortfolioPicker options={c.options} selectedId={c.selectedId} onSelect={c.select} />
      </header>

      <PositionsKpiGroups c={c} />
      {t.missingPrices > 0 && <p className="muted small">{t.missingPrices} titoli senza prezzo aggiornato: esclusi dai totali.</p>}

      <MarginCard c={c} />

      <Issues result={c.result} portfolio={c.portfolio} />

      <PriceBar
        eurUsd={c.eurUsd}
        currency={currency}
        onCurrency={setCurrency}
        weightBase={weightBase}
        onWeightBase={setWeightBase}
        lossesEur={availableLosses(c.result.fiscal, currentYear)}
        pricesAt={c.pricesAt}
        loading={c.pricesLoading}
        onRefresh={c.refreshPrices}
      />

      <div className="toolbar">
        <label className="inline">
          Ordina per
          <select value={sort} onChange={e => setSort(e.target.value as SortKey)}>
            {SORTS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </label>
      </div>

      {/* Telefono: schede. PC: tabella. Nessuno scorrimento laterale: sotto i 1300px
          quantità e variazione del giorno vanno sotto titolo e prezzo (5 colonne invece di 7). */}
      <ul className="pos-cards">
        {open.map(r => <PositionCard key={r.assetId} r={r} shown={shown} weight={weightText(r.assetId)} />)}
      </ul>
      <table className="pos-table">
        <thead>
          <tr>
            <th>Titolo</th><th className="num col-wide">Quantità</th><th className="num">PMC</th>
            <th className="num">Prezzo<span className="col-narrow"> · oggi</span></th>
            <th className="num col-wide">Oggi</th><th className="num">Valore<span className="col-narrow"> · peso</span></th>
            <th className="num col-wide">Peso</th><th className="num">Risultato</th>
          </tr>
        </thead>
        <tbody>
          {open.map(r => (
            <tr key={r.assetId}>
              <td>
                <b>{r.symbol}</b>{r.isShort && <Tag tone="short">short</Tag>}
                <small className="col-narrow cell-sub muted">{qty(Math.abs(r.qty))} {Math.abs(r.qty) === 1 ? 'azione' : 'azioni'}</small>
              </td>
              <td className="num col-wide">{qty(r.qty)}</td>
              <td className="num">{money(r.pmcNative, r.currency)}</td>
              <td className="num">
                {money(r.price, r.currency)}
                <small className={`col-narrow cell-sub ${tone(r.dayChangePct)}`}>{pct(r.dayChangePct)}</small>
              </td>
              <td className={`num col-wide ${tone(r.dayChangePct)}`}>{pct(r.dayChangePct)}</td>
              <td className="num">
                {shown(r.valueEur)}
                <small className="col-narrow cell-sub muted">{weightText(r.assetId)}</small>
              </td>
              <td className="num col-wide">{weightText(r.assetId)}</td>
              <td className={`num ${tone(r.unrealizedEur)}`}>{shown(r.unrealizedEur, true)}<br /><small>{pct(r.unrealizedPct)}</small></td>
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
                  <span className={tone(r.realizedEur)}>{shown(r.realizedEur, true)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}

const NONE = {}

function PositionCard({ r, shown, weight }: { r: PositionRow; shown: (x: number | null, signed?: boolean) => string; weight: string }) {
  return (
    <li className="card pos-card">
      <div className="pos-card-head">
        <b>{r.symbol}</b>
        {r.isShort && <Tag tone="short">short</Tag>}
        <span className={`pos-day ${tone(r.dayChangePct)}`}>{pct(r.dayChangePct)}</span>
      </div>
      <div className="pos-card-main">
        <span className="pos-value">{shown(r.valueEur)}</span>
        <span className={tone(r.unrealizedEur)}>{shown(r.unrealizedEur, true)} · {pct(r.unrealizedPct)}</span>
      </div>
      <div className="pos-card-meta muted">
        {qty(r.qty)} × {money(r.price, r.currency)} · PMC {money(r.pmcNative, r.currency)} · <span className="nowrap">peso {weight}</span>
      </div>
    </li>
  )
}
