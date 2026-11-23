// Barra sopra la tabella Posizioni (come nel sito vecchio): cambio EUR/USD, valuta mostrata, base dei pesi,
// cassetto fiscale e ora dell'ultimo aggiornamento dei prezzi con il pulsante Aggiorna.
import { Link } from 'react-router'
import type { LiveFx } from '../data/useComputedPortfolio'
import type { DisplayCurrency, WeightBase } from '../domain/display'
import { eur, pct, tone } from '../lib/format'

const rateFmt = new Intl.NumberFormat('it-IT', { minimumFractionDigits: 4, maximumFractionDigits: 4 })
const timeFmt = (ms: number) => {
  const d = new Date(ms)
  const today = new Date().toDateString() === d.toDateString()
  return today
    ? d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

interface Props {
  eurUsd: LiveFx | null
  currency: DisplayCurrency
  onCurrency: (c: DisplayCurrency) => void
  weightBase: WeightBase
  onWeightBase: (w: WeightBase) => void
  /** Minus ancora da compensare: se ci sono, il cassetto mostra "!". */
  lossesEur: number
  pricesAt: number | null
  loading: boolean
  onRefresh: () => void
}

function Seg<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { key: T; text: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      <span className="seg-label">{label}</span>
      {options.map(o => (
        <button key={o.key} type="button" aria-pressed={value === o.key} onClick={() => onChange(o.key)}>{o.text}</button>
      ))}
    </div>
  )
}

export function PriceBar(p: Props) {
  return (
    <div className="price-bar">
      <span className="fx-live" title="Cambio di mercato in tempo reale (Yahoo). I calcoli fiscali usano i cambi ufficiali del giorno di ogni movimento.">
        {p.eurUsd ? (
          <>
            1 € = <b>{rateFmt.format(p.eurUsd.rate)} $</b>
            {p.eurUsd.changePct !== null && <small className={tone(p.eurUsd.changePct)}> {pct(p.eurUsd.changePct)}</small>}
          </>
        ) : (
          <span className="muted">cambio EUR/USD non disponibile</span>
        )}
      </span>
      <Seg label="Mostra in" value={p.currency} onChange={p.onCurrency} options={[{ key: 'EUR', text: '€ EUR' }, { key: 'USD', text: '$ USD' }]} />
      <Seg label="Peso su" value={p.weightBase} onChange={p.onWeightBase} options={[{ key: 'portfolio', text: 'Portafoglio' }, { key: 'all', text: 'Tutti' }]} />
      <Link to="/fiscale" className="fiscal-chip" title={p.lossesEur > 0 ? `Minus da compensare: ${eur(p.lossesEur)}` : 'Nessuna minus da compensare'}>
        Cassetto fiscale
        {p.lossesEur > 0 && <span className="fiscal-alert" aria-label="minus da compensare">!</span>}
      </Link>
      <span className="price-time">
        <small className="muted">{p.loading ? 'aggiorno i prezzi…' : p.pricesAt ? `prezzi delle ${timeFmt(p.pricesAt)}` : 'prezzi non ancora scaricati'}</small>
        <button type="button" className="btn btn-ghost btn-small" onClick={p.onRefresh} disabled={p.loading}>Aggiorna</button>
      </span>
    </div>
  )
}
