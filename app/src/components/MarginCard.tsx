import { useState } from 'react'
import { parseLeverage, useMaxLeverage } from '../data/maxLeverage'
import type { Computed } from '../data/useComputedPortfolio'
import { leverageAlert, summarizeMargin, type MarginPortfolio } from '../domain/engine/margin'
import { eur, money, THIS_YEAR } from '../lib/format'
import { MarginStress } from './MarginStress'
import { Kpi } from './PortfolioPicker'

type Ready = Extract<Computed, { status: 'ready' }>

const x = (v: number | null) => (v === null ? '—' : `${v.toFixed(2).replace('.', ',')}x`)

/** Margine usato, leva e interessi del conto IBKR, con avviso se la leva supera la soglia scelta. Non compare senza dati di margine. */
export function MarginCard({ c }: { c: Ready }) {
  const [max, setMax] = useMaxLeverage()

  const m = summarizeMargin(c.portfolio as MarginPortfolio, c.rows, c.latestFx, THIS_YEAR)
  if (!m) return null
  const alert = leverageAlert(m.leverage, max)
  const date = new Date(m.date + 'T12:00:00').toLocaleDateString('it-IT')
  const debts = m.balances.filter(b => b.cash < 0)

  return (
    <div className={`card${alert === 'over' ? ' error' : alert === 'near' ? ' warn' : ''}`} role={alert === 'over' ? 'alert' : undefined}>
      <h2>Margine</h2>
      {alert === 'over' && <p><b>Leva sopra la soglia:</b> {x(m.leverage)} contro un massimo di {x(max)}.</p>}
      {alert === 'near' && <p><b>Attenzione:</b> la leva ({x(m.leverage)}) è vicina al massimo di {x(max)}.</p>}
      <div className="kpis">
        <Kpi label="Margine usato" value={eur(m.usedEur)} hint={debts.map(b => money(-b.cash, b.currency)).join(' · ') || 'nessun debito'} />
        <Kpi label="Leva" value={x(m.leverage)} hint={m.equityEur > 0 ? `patrimonio netto ${eur(m.equityEur)}` : undefined} />
        <Kpi label={`Interessi pagati ${THIS_YEAR}`} value={eur(-m.paidYearEur, true)} hint={m.accruedEur > 0 ? `+ ${eur(m.accruedEur)} maturati` : undefined} className={m.paidYearEur > 0 ? 'neg' : ''} />
        <Kpi label="Costo al giorno" value={eur(m.dailyCostEur)} hint={`stima: circa ${eur(m.monthlyCostEur)} al mese`} />
      </div>
      <LeverageForm key={String(max)} max={max} onSave={setMax} />
      <p className="muted small">
        Dati IBKR del {date}; leva = valore delle posizioni (long e short) diviso patrimonio netto, prezzi di adesso.
        {m.missingPrices > 0 && ` ${m.missingPrices} titoli senza prezzo: leva approssimata.`}
        {m.incomplete.length > 0 && ` Costo stimato senza ${m.incomplete.join(', ')} (tasso o cambio non disponibile).`}
        {max === null && ' Imposta una leva massima per ricevere l’avviso (vale su tutti i dispositivi).'}
      </p>
      <MarginStress m={m} />
    </div>
  )
}

/** Campo della soglia. Con key sul valore salvato si riallinea da solo quando la soglia cambia da un altro dispositivo. */
function LeverageForm({ max, onSave }: { max: number | null; onSave: (v: number | null) => Promise<void> }) {
  const [text, setText] = useState(max === null ? '' : String(max).replace('.', ','))
  const [error, setError] = useState('')
  const save = (v: number | null) => {
    setError('')
    onSave(v).catch(() => setError('Non sono riuscito a salvare la soglia.'))
  }
  return (
    <form
      className="inline"
      onSubmit={e => {
        e.preventDefault()
        if (text.trim() && parseLeverage(text) === null) return setError('Scrivi un numero da 1 in su, per esempio 1,3.')
        save(parseLeverage(text))
      }}
    >
      <label>
        Leva massima
        <input type="text" inputMode="decimal" placeholder="es. 1,3" value={text} onChange={e => setText(e.target.value)} style={{ width: '5em', marginLeft: 8 }} />
      </label>
      <button type="submit" className="btn btn-ghost">Salva</button>
      {max !== null && <button type="button" className="linklike" onClick={() => save(null)}>Togli</button>}
      {error && <span className="neg small" role="alert"> {error}</span>}
    </form>
  )
}
