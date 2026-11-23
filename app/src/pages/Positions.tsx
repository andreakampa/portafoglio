import { Issues } from '../components/Issues'
import { MarginCard } from '../components/MarginCard'
import { PositionsKpiGroups } from '../components/PositionsKpiGroups'
import { PositionsTable } from '../components/PositionsTable'
import { PriceBar } from '../components/PriceBar'
import { PortfolioPicker } from '../components/PortfolioPicker'
import { useAllPortfoliosValue } from '../data/useAllPortfoliosValue'
import { useComputedPortfolio } from '../data/useComputedPortfolio'
import { useViewPref } from '../data/viewPrefs'
import { grossValueEur, toDisplay, weights, type DisplayCurrency, type WeightBase } from '../domain/display'
import { availableLosses } from '../domain/engine/fiscal'
import { cash, THIS_YEAR } from '../lib/format'

export function Positions() {
  const c = useComputedPortfolio()
  const [currency, setCurrency] = useViewPref<DisplayCurrency>('currency', ['EUR', 'USD'], 'EUR')
  const [weightBase, setWeightBase] = useViewPref<WeightBase>('weightBase', ['portfolio', 'all'], 'portfolio')
  const ready = c.status === 'ready'
  const allValue = useAllPortfoliosValue(ready && weightBase === 'all', ready ? c.portfolios : NONE, ready ? c.allResults : NONE, ready ? c.latestFx : NONE)

  if (c.status === 'loading') return <section className="page"><h1>Posizioni</h1><div className="card skeleton" style={{ height: 240 }} /></section>
  if (c.status === 'error') return <section className="page"><h1>Posizioni</h1><div className="card error">{c.message}</div></section>
  if (c.status === 'empty') return <section className="page"><h1>Posizioni</h1><div className="card">Nessun portafoglio.</div></section>

  const open = c.rows.filter(r => r.qty !== 0)
  // Importi della tabella nella valuta scelta (cambio di mercato di oggi); i riquadri restano in euro.
  const usdRate = c.eurUsd?.rate ?? c.latestFx.USD ?? null
  const shown = (x: number | null, signed = false) => cash(toDisplay(x, currency, usdRate), currency, signed)
  const weightOf = weights(open, weightBase === 'all' ? allValue ?? 0 : grossValueEur(open))

  return (
    <section className="page">
      <header className="page-head">
        <h1>Posizioni</h1>
        <PortfolioPicker options={c.options} selectedId={c.selectedId} onSelect={c.select} />
      </header>

      <PositionsKpiGroups c={c} />
      {c.totals.missingPrices > 0 && <p className="muted small">{c.totals.missingPrices} titoli senza prezzo aggiornato: esclusi dai totali.</p>}

      <MarginCard c={c} />

      <Issues result={c.result} portfolio={c.portfolio} />

      <PriceBar
        eurUsd={c.eurUsd}
        currency={currency}
        onCurrency={setCurrency}
        weightBase={weightBase}
        onWeightBase={setWeightBase}
        lossesEur={availableLosses(c.result.fiscal, THIS_YEAR)}
        pricesAt={c.pricesAt}
        loading={c.pricesLoading}
        onRefresh={c.refreshPrices}
      />

      <PositionsTable c={c} shown={shown} weightOf={weightOf} convert={x => toDisplay(x, currency, usdRate)} currency={currency} />
    </section>
  )
}

const NONE = {}
