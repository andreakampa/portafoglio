// Fiscale: come si arriva a una plus o minus. Il movimento che chiude (vendita o ricopertura), i lotti che chiude
// (acquisti, o vendite allo scoperto per gli short), cambi, commissioni e il calcolo finale con le tasse.
import type { FiscalLine } from '../domain/engine/fiscal'
import type { CostMethod } from '../domain/engine/types'
import { cash, eur, money, qty, tone } from '../lib/format'

const day = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('it-IT')
const rateText = (rate: number, currency: string) => `1 € = ${rate.toLocaleString('it-IT', { maximumFractionDigits: 4 })} ${currency}`

const METHOD: Record<CostMethod, string> = {
  average: 'costo medio ponderato (regime amministrato): ogni vendita usa il prezzo medio di tutti gli acquisti ancora aperti',
  lifo: 'LIFO (regime dichiarativo): si vendono prima le azioni comprate per ultime',
  fifo: 'FIFO: si vendono prima le azioni comprate per prime',
}

export function FiscalLineDetail({ l }: { l: FiscalLine }) {
  const d = l.detail
  if (!d || l.qty == null || l.proceedsEur == null || l.costEur == null) return null
  const short = l.side === 'short'
  const foreign = d.currency !== 'EUR'
  const n = qty(l.qty)
  const units = l.qty === 1 ? 'azione' : 'azioni'
  const lotsEur = d.lots.reduce((s, x) => s + x.costEur, 0)
  const lotsNative = d.lots.reduce((s, x) => s + x.costNative, 0)
  // Movimento che chiude: per i long è l'incasso della vendita, per gli short il costo della ricopertura.
  const closeNative = short ? d.costNative : d.proceedsNative
  const closeEur = short ? l.costEur : l.proceedsEur
  const gainNative = d.proceedsNative - d.costNative
  // Effetto del cambio: differenza tra il risultato in euro e quello in valuta convertito al cambio di oggi della vendita.
  const fxEffect = foreign ? l.gainEur - gainNative / d.rate : 0

  return (
    <div className="fiscal-detail">
      <section>
        <h3>{short ? `Ricopertura del ${day(l.date)}` : `Vendita del ${day(l.date)}`}</h3>
        <dl>
          <div><dt>{n} {units} × {money(d.price, d.currency)}</dt><dd>{cash(d.grossNative, d.currency)}</dd></div>
          {Math.abs(d.premiumNative) > 0.005 && (
            <div><dt>Premio dell'opzione esercitata</dt><dd>{cash(d.premiumNative, d.currency, true)}</dd></div>
          )}
          {d.commissionNative > 0.005 && (
            <div><dt>Commissioni</dt><dd>{short ? '+' : '−'}{cash(d.commissionNative, d.currency)}</dd></div>
          )}
          <div className="total">
            <dt>{short ? 'Costo della ricopertura' : 'Incasso netto'}{foreign && <small className="muted"> al cambio del giorno ({rateText(d.rate, d.currency)})</small>}</dt>
            <dd>{foreign && <>{cash(closeNative, d.currency)} → </>}<b>{eur(closeEur)}</b></dd>
          </div>
        </dl>
      </section>

      <section>
        <h3>{short ? 'Vendite allo scoperto chiuse' : 'Acquisti chiusi da questa vendita'}</h3>
        <p className="muted small">Metodo: {METHOD[d.method]}. {short ? 'Importi al netto delle commissioni.' : 'Costi con le commissioni d’acquisto.'}</p>
        <div className="fiscal-lots-wrap">
        <table className="fiscal-lots">
          <thead>
            <tr>
              <th>Data</th><th className="num">Quantità</th><th className="num">Prezzo medio</th>
              {foreign && <th className="num col-native">In {d.currency}</th>}
              <th className="num">In €</th>
            </tr>
          </thead>
          <tbody>
            {d.lots.map((x, i) => (
              <tr key={i}>
                <td>{day(x.date)}</td>
                <td className="num">{qty(x.qty)}</td>
                <td className="num">{money(x.qty ? x.costNative / x.qty : null, d.currency)}</td>
                {foreign && <td className="num col-native">{cash(x.costNative, d.currency)}</td>}
                <td className="num">
                  {eur(x.costEur)}
                  {foreign && x.costEur > 0 && <small className="muted cell-sub">{rateText(x.costNative / x.costEur, d.currency)}</small>}
                </td>
              </tr>
            ))}
          </tbody>
          {d.lots.length > 1 && (
            <tfoot>
              <tr>
                <td>Totale</td><td className="num">{n}</td>
                <td className="num">{money(l.qty ? lotsNative / l.qty : null, d.currency)}</td>
                {foreign && <td className="num col-native">{cash(lotsNative, d.currency)}</td>}
                <td className="num"><b>{eur(lotsEur)}</b></td>
              </tr>
            </tfoot>
          )}
        </table>
        </div>
      </section>

      <section>
        <h3>Risultato</h3>
        <dl>
          <div><dt>{short ? 'Incasso delle vendite allo scoperto' : 'Incasso netto'}</dt><dd>{eur(l.proceedsEur)}</dd></div>
          <div><dt>{short ? 'Costo della ricopertura' : 'Costo degli acquisti'}</dt><dd>−{eur(l.costEur)}</dd></div>
          <div className="total"><dt>{l.gainEur >= 0 ? 'Plusvalenza' : 'Minusvalenza'}</dt><dd className={tone(l.gainEur)}><b>{eur(l.gainEur, true)}</b></dd></div>
          {foreign && Math.abs(fxEffect) >= 0.01 && (
            <div>
              <dt className="muted">In {d.currency} il risultato è {cash(gainNative, d.currency, true)}: la differenza è dovuta al cambio</dt>
              <dd className={tone(fxEffect)}>{eur(fxEffect, true)}</dd>
            </div>
          )}
          {l.excluded && <div><dt className="muted">ETF o fondo: la plus è reddito di capitale e non si compensa con le minus</dt><dd /></div>}
          {l.compensatedEur > 0.005 && <div><dt>Minus usate per compensare</dt><dd>−{eur(l.compensatedEur)}</dd></div>}
          {l.gainEur > 0.005 && <div><dt>Imponibile</dt><dd>{eur(l.taxableEur)}</dd></div>}
          {l.gainEur > 0.005 && <div><dt>Imposta stimata</dt><dd>{eur(l.taxEur)}</dd></div>}
          {l.gainEur > 0.005 && <div className="total"><dt>Guadagno netto dopo le tasse</dt><dd className={tone(l.gainEur - l.taxEur)}><b>{eur(l.gainEur - l.taxEur, true)}</b></dd></div>}
          {l.gainEur < -0.005 && <div><dt className="muted">La minus va nel cassetto fiscale e si può usare per 4 anni</dt><dd /></div>}
        </dl>
      </section>
    </div>
  )
}
