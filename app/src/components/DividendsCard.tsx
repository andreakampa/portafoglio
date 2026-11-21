import { useDividends } from '../data/useDividends'
import { summarizeDividends } from '../domain/engine/dividends'
import type { RawPortfolio } from '../domain/engine/portfolio'
import type { FxLookup } from '../domain/engine/types'
import { FOREIGN_ACCOUNT_FIXED, wealthTax, wealthTaxKindFor } from '../domain/engine/wealthTax'
import { eur } from '../lib/format'

interface Props {
  portfolio: RawPortfolio
  fx: FxLookup
  regime: string
  year: number
  currentYear: number
  /** Imposta sulle plus dell'anno (già calcolata dal cassetto). */
  gainsTaxEur: number
  /** Valore attuale del portafoglio, per stimare bollo/IVAFE. */
  valueEur: number
}

/** Dividendi dell'anno e riepilogo di tutte le imposte stimate (plus, dividendi, bollo/IVAFE). */
export function DividendsCard({ portfolio, fx, regime, year, currentYear, gainsTaxEur, valueEur }: Props) {
  const d = useDividends(portfolio, fx)
  const dichiarativo = regime === 'dichiarativo'
  const y = summarizeDividends(d.rows).find(x => x.year === year)
  const kind = wealthTaxKindFor(regime)
  const patrimonial = year === currentYear ? wealthTax({ kind, valueEur }) + (dichiarativo ? FOREIGN_ACCOUNT_FIXED : 0) : null
  const divTax = y?.taxEur ?? 0
  const total = gainsTaxEur + divTax + (patrimonial ?? 0)

  return (
    <>
      <div className="card">
        <h2>Dividendi {year}</h2>
        {d.status === 'loading' ? (
          <p className="muted">Calcolo in corso…</p>
        ) : !y ? (
          <p className="muted">Nessun dividendo nel {year}.</p>
        ) : (
          <>
            <ul className="plain-list">
              <li><span>Lordo</span><b>{eur(y.grossEur)}</b></li>
              <li><span>Ritenute estere pagate</span><b>{eur(-y.withholdingEur)}</b></li>
              <li>
                <span>{dichiarativo ? 'Imposta 26% da dichiarare (nessun credito estero)' : 'Imposta 26% trattenuta dalla banca'}</span>
                <b>{eur(-y.taxEur)}</b>
              </li>
              <li><span>{dichiarativo ? 'Incassato (prima dell’imposta italiana)' : 'Netto incassato'}</span><b>{eur(dichiarativo ? y.grossEur - y.withholdingEur : y.netEur)}</b></li>
            </ul>
            <ul className="fiscal-lines">
              {y.rows.map(r => (
                <li key={r.key}>
                  <div>
                    <b>{r.symbol || 'Dividendo'}</b>
                    <br />
                    <small className="muted">{new Date(r.date + 'T12:00:00').toLocaleDateString('it-IT')}{r.source === 'stima' ? ' · stima' : ''}</small>
                  </div>
                  <div className="num">
                    <span>{eur(r.grossEur)}</span>
                    <small className="muted">netto {eur(r.netEur)}</small>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
        <p className="muted small">
          {d.source === 'ibkr'
            ? 'Importi veri dal conto IBKR (movimenti di cassa), cambio del giorno.'
            : 'Stima: importo per azione di Yahoo × quantità posseduta prima dello stacco; ritenuta 15% sui titoli in USD, 0 altrove. Può differire dall’accredito reale.'}
        </p>
      </div>

      <div className="card">
        <h2>Imposte stimate {year}</h2>
        <ul className="plain-list">
          <li><span>Plus e minus (26%, 12,5% titoli di Stato, 33% crypto)</span><b>{eur(gainsTaxEur)}</b></li>
          <li><span>Dividendi</span><b>{eur(divTax)}</b></li>
          {patrimonial !== null && (
            <li>
              <span>{kind === 'ivafe' ? `IVAFE (2‰ sul valore + ${eur(FOREIGN_ACCOUNT_FIXED)} conto estero)` : 'Imposta di bollo (2‰ sul valore)'}</span>
              <b>{eur(patrimonial)}</b>
            </li>
          )}
          <li><span><b>Totale</b></span><b>{eur(total)}</b></li>
        </ul>
        <p className="muted small">
          {dichiarativo
            ? 'Dichiarativo: tutto si versa con la dichiarazione (F24 a giugno); l’IVAFE va indicata nel quadro RW.'
            : 'Amministrato: imposte e bollo li trattiene la banca. Il bollo è stimato sul valore attuale, non su quello al 31/12.'}
          {patrimonial === null && ' Il bollo/IVAFE degli anni passati non è calcolato (serve il valore al 31/12).'}
        </p>
      </div>
    </>
  )
}
