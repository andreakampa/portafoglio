// Numeri chiave della pagina Posizioni in due gruppi (Portafoglio e Performance), come nel sito vecchio.
import { useMemo } from 'react'
import type { Computed } from '../data/useComputedPortfolio'
import { useDividends } from '../data/useDividends'
import { marginInterest } from '../domain/engine/movements'
import { positionsKpis } from '../domain/positionsKpis'
import { simulate, type SimOp } from '../domain/simulation'
import { eur, pct, THIS_YEAR, tone } from '../lib/format'
import { Kpi } from './PortfolioPicker'

type Ready = Extract<Computed, { status: 'ready' }>

export function PositionsKpiGroups({ c }: { c: Ready }) {
  const d = useDividends(c.portfolio, c.fx)
  // Imposta se si vendesse (o ricoprisse) tutto oggi: il simulatore rifà il cassetto, perdite e minus compensano.
  const exitTaxEur = useMemo(() => {
    const ops: SimOp[] = c.rows
      .filter(r => r.qty !== 0 && r.price !== null)
      .map(r => ({ id: r.assetId, assetId: r.assetId, type: r.isShort ? 'buy_to_cover' : 'sell', qty: Math.abs(r.qty), price: r.price!, commissionEur: 0 }))
    if (!ops.length) return 0
    try {
      return simulate({ portfolio: c.portfolio, fx: c.fx, latestFx: c.latestFx, ops, today: new Date().toISOString().slice(0, 10) }).taxEur
    } catch {
      return null
    }
  }, [c.rows, c.portfolio, c.fx, c.latestFx])
  const assetTypes = Object.fromEntries(Object.entries(c.portfolio.assets ?? {}).map(([id, a]) => [id, a.tipoAsset]))
  const k = positionsKpis({
    rows: c.rows,
    positions: c.result.positions,
    assetTypes,
    lines: c.result.fiscal.lines,
    marginInterest: marginInterest(c.portfolio),
    dividends: d.rows,
    latestFx: c.latestFx,
    year: THIS_YEAR,
    exitTaxEur,
  })
  const dich = c.result.regime === 'dichiarativo'
  return (
    <div className="kpi-groups">
      <section className="kpi-group" aria-label="Portafoglio">
        <h2 className="kpi-group-title">Portafoglio</h2>
        <div className="kpis kpis-6">
          <Kpi label="Investito" value={eur(k.investedEur)} hint="costo al cambio di oggi" />
          <Kpi label="Controvalore" value={eur(k.valueEur)} hint={c.pricesLoading ? 'aggiorno i prezzi…' : undefined} />
          <Kpi label="Commissioni pagate" value={eur(k.commissionsEur)} hint="tutti i movimenti" />
          {k.marginInterestEur !== null && <Kpi label="Interessi margine" value={eur(k.marginInterestEur)} hint="totale addebitato" />}
          <Kpi
            label="Dividendi"
            value={d.status === 'loading' ? '…' : eur(k.dividendsReceivedEur)}
            className={tone(k.dividendsReceivedEur)}
            hint={d.source === 'stima' ? 'incassati finora (stima Yahoo)' : 'incassati finora, netto ritenuta'}
            to="/fiscale"
          />
          <Kpi label={`Tasse su plus ${THIS_YEAR}`} value={eur(k.taxYearEur)} hint={dich ? 'stima, da versare' : 'stima, trattenute'} to="/fiscale" />
        </div>
      </section>
      <section className="kpi-group" aria-label="Performance">
        <h2 className="kpi-group-title">Performance</h2>
        <div className="kpis kpis-6">
          <Kpi label="Non realizzato" value={eur(k.unrealizedEur, true)} className={tone(k.unrealizedEur)} hint={`${pct(k.unrealizedPct)} · cambio di oggi`} />
          <Kpi label="Non realizzato netto" value={eur(k.afterTaxEur, true)} className={tone(k.afterTaxEur)} hint={`${pct(k.afterTaxPct)} · ${k.unrealizedTaxEur < 0 ? `risparmio d’imposta ${eur(-k.unrealizedTaxEur)}` : `tasse ${eur(k.unrealizedTaxEur)}`} vendendo tutto oggi`} />
          <Kpi label="Realizzato lordo" value={eur(k.realizedGrossEur, true)} className={tone(k.realizedGrossEur)} hint="da sempre" />
          <Kpi label="Realizzato netto" value={eur(k.realizedNetEur, true)} className={tone(k.realizedNetEur)} hint="dopo le tasse del cassetto" />
          <Kpi label="Totale netto" value={eur(k.totalAfterTaxEur, true)} className={tone(k.totalAfterTaxEur)} hint="realizzato netto + non realizzato netto" />
          <Kpi label="Non realizzato fiscale" value={eur(k.historicEur, true)} className={tone(k.historicEur)} hint={`${pct(k.historicPct)} · cambi storici Banca d'Italia`} />
        </div>
      </section>
    </div>
  )
}
