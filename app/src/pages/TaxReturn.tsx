import { useState } from 'react'
import { Link } from 'react-router'
import { Kpi } from '../components/PortfolioPicker'
import { StatementImport } from '../components/StatementImport'
import { useTaxReturn, type RateMode, type TaxReturnData } from '../data/useTaxReturn'
import { bonusKeyOf, type BonusGrant } from '../domain/bonusShares'
import type { RawPortfolio } from '../domain/engine/portfolio'
import { RM_LETTERS, toEuro } from '../domain/engine/taxReturn'
import { eur, money, qty } from '../lib/format'

const it = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('it-IT')
/** Unità di euro col punto delle migliaia anche sotto 10.000 (es. 4.675). */
const whole = (n: number) => String(toEuro(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')

interface Field {
  where: string
  label: string
  value: string
}

/** Righe da copiare nel modello, quadro per quadro (importi in unità di euro). */
function fieldsOf(d: TaxReturnData): Record<'RT' | 'RM' | 'RW', Field[]> {
  const { rt, rm, rw } = d
  const RT: Field[] = [
    { where: 'RT11 col. 1', label: 'Totale dei corrispettivi', value: whole(rt.proceedsEur) },
    { where: 'RT11 col. 2', label: 'Totale dei costi fiscalmente riconosciuti', value: whole(rt.costEur) },
    rt.netEur >= 0
      ? { where: 'RT52 col. 2', label: 'Plusvalenza', value: whole(rt.netEur) }
      : { where: 'RT52 col. 1', label: 'Minusvalenza', value: whole(-rt.netEur) },
  ]
  if (rt.usedLossesEur > 0.5) RT.push({ where: 'RT13 e RT71 col. 3', label: 'Minus degli anni precedenti usate', value: whole(rt.usedLossesEur) })
  if (rt.netEur > 0) {
    RT.push({ where: 'RT72', label: 'Imponibile', value: whole(rt.taxableEur) })
    RT.push({ where: 'RT73 e RT74', label: 'Imposta sostitutiva 26%', value: whole(rt.taxEur) })
  }
  for (const p of rt.priorLosses.filter(p => p.carriedEur > 0.5)) {
    RT.push({ where: 'RT102', label: `Minus del ${p.year} ancora da usare (fino al ${p.expiresYear})`, value: whole(p.carriedEur) })
  }
  if (rt.newLossEur > 0.5) RT.push({ where: 'RT102 col. 5', label: `Minus del ${rt.year} da riportare (fino al ${rt.year + 4})`, value: whole(rt.newLossEur) })

  const RM: Field[] = rm.rows.flatMap((r, i) => [
    { where: `RM31 (rigo ${i + 1}) col. 1`, label: 'Tipo di reddito', value: r.letter },
    { where: `RM31 (rigo ${i + 1}) col. 2`, label: 'Stato estero', value: r.country ? `${r.country.code} (${r.country.name})` : `da cercare: ${r.iso ?? 'Stato non noto'}` },
    { where: `RM31 (rigo ${i + 1}) col. 3`, label: 'Reddito lordo', value: whole(r.grossEur) },
    { where: `RM31 (rigo ${i + 1}) col. 4`, label: 'Aliquota', value: `${r.ratePct}` },
    { where: `RM31 (rigo ${i + 1}) col. 8`, label: 'Imposta dovuta', value: whole(r.taxEur) },
  ])

  const dep = rw.deposit
  const RW: Field[] = rw.holdings.length
    ? [
        { where: 'RW1 col. 1', label: 'Titolo di possesso', value: '1 (proprietà)' },
        { where: 'RW1 col. 3', label: 'Codice del bene', value: '20 (conto deposito titoli all’estero)' },
        { where: 'RW1 col. 4', label: 'Stato estero', value: dep.country ? `${dep.country.code} (${dep.country.name})` : dep.iso },
        { where: 'RW1 col. 5', label: 'Quota di possesso', value: '100' },
        { where: 'RW1 col. 6', label: 'Criterio del valore', value: '1 (valore di mercato)' },
        { where: 'RW1 col. 7', label: 'Valore iniziale', value: whole(dep.startEur) },
        { where: 'RW1 col. 8', label: 'Valore finale', value: whole(dep.endEur) },
        { where: 'RW1 col. 10', label: 'Giorni (media pesata)', value: String(dep.days) },
        { where: 'RW1 col. 14', label: 'Quadri compilati', value: d.rt.sales.length && d.rm.rows.length ? '4 (RM e RT)' : d.rm.rows.length ? '2 (RM)' : d.rt.sales.length ? '3 (RT)' : '5 (nessun reddito)' },
        { where: 'RW1 col. 29 e 30', label: 'IVAFE', value: whole(dep.ivafeEur) },
        { where: 'RW6 col. 1', label: 'IVAFE totale', value: whole(rw.ivafeEur) },
      ]
    : []
  return { RT, RM, RW }
}

function FieldList({ fields }: { fields: Field[] }) {
  const [copied, setCopied] = useState<string | null>(null)
  const copy = (f: Field) => {
    void navigator.clipboard?.writeText(f.value.replace(/\./g, '')).then(() => {
      setCopied(f.where + f.label)
      setTimeout(() => setCopied(null), 1200)
    })
  }
  return (
    <ul className="plain-list tax-fields">
      {fields.map(f => (
        <li key={f.where + f.label}>
          <span>
            <b className="tax-where">{f.where}</b>
            <br />
            <small className="muted">{f.label}</small>
          </span>
          <button type="button" className="tax-value" onClick={() => copy(f)} title="Copia">
            {f.value}
            <small className="muted">{copied === f.where + f.label ? ' copiato' : ''}</small>
          </button>
        </li>
      ))}
    </ul>
  )
}

/** Azioni premio del broker: in maturazione (solo quadro RW) o maturate (acquisto registrato, reddito nel quadro RM). */
function BonusCard({ grants, portfolio }: { grants: BonusGrant[]; portfolio: RawPortfolio }) {
  const txs = Object.values(portfolio.assets ?? {}).flatMap(a => a.transactions ?? [])
  const sorted = [...grants].sort((a, b) => a.vestDate.localeCompare(b.vestDate))
  return (
    <div className="card">
      <h2>Azioni premio del broker</h2>
      <ul className="fiscal-lines">
        {sorted.map(g => {
          const tx = txs.find(t => t.bonusKey === bonusKeyOf(g))
          return (
            <li key={g.id}>
              <div>
                <b>{qty(g.qty)} {g.symbol}</b>
                <br />
                <small className="muted">assegnate il {it(g.grantDate)} · maturano il {it(g.vestDate)}</small>
              </div>
              <div className="num">
                {tx ? <span className="pos">registrate</span> : <span className="muted">in maturazione</span>}
                <small className="muted">{tx ? `${it(tx.date)} a ${money(Number(tx.price), g.currency)}` : `assegnazione a ${money(g.grantPrice, g.currency)}`}</small>
              </div>
            </li>
          )
        })}
      </ul>
      <p className="muted small">
        Le azioni diventano tue alla maturazione: l’app le registra da sola quel giorno, al prezzo di chiusura. Quel valore è il loro
        costo fiscale e un reddito da dichiarare nel quadro RM (lettera G, 26%) dell’anno della maturazione. Prima stanno solo nel
        quadro RW. Classificazione da confermare col commercialista (in alternativa: quadro RL, reddito diverso).
      </p>
    </div>
  )
}

export function TaxReturn() {
  const [picked, setPicked] = useState<string | null>(null)
  const [year, setYear] = useState<number | null>(null)
  const [mode, setMode] = useState<RateMode>('bdi')
  const s = useTaxReturn(picked, year, mode)

  const head = (
    <header className="page-head">
      <Link to="/fiscale" className="muted small">← Fiscale</Link>
      <h1>Dichiarazione dei redditi</h1>
    </header>
  )
  if (s.status === 'loading') return <section className="page">{head}<div className="card skeleton" style={{ height: 240 }} /></section>
  if (s.status === 'error') return <section className="page">{head}<div className="card error">{s.message}</div></section>
  if (s.status === 'empty') return <section className="page">{head}<div className="card">Nessun portafoglio in regime dichiarativo: per gli amministrati le imposte le paga la banca e non serve questo prospetto.</div></section>

  const d = s.data
  const y = d?.year ?? s.years[0]!
  const fields = d ? fieldsOf(d) : null
  const allText = d && fields
    ? [`Prospetto dichiarazione ${y} (cambi ${mode === 'bdi' ? 'Banca d’Italia' : 'IBKR'})`, ...(['RT', 'RM', 'RW'] as const).flatMap(q => [``, `Quadro ${q}`, ...fields[q].map(f => `${f.where}\t${f.label}\t${f.value}`)])].join('\n')
    : ''

  return (
    <section className="page tax-return">
      {head}
      <p className="muted small">
        Prospetto per il modello <b>Redditi PF {y + 1}</b> (anno d’imposta {y}). Nel <b>730</b> gli stessi dati vanno nei quadri
        <b> T</b> (plusvalenze), <b>M</b> (redditi esteri) e <b>W</b> (investimenti esteri e IVAFE), con la stessa logica.
        Tocca un importo per copiarlo.
      </p>

      {s.options.length > 1 && (
        <div className="pills" role="tablist" aria-label="Portafoglio">
          {s.options.map(o => (
            <button key={o.id} type="button" role="tab" aria-selected={o.id === s.selectedId} className={`pill ${o.id === s.selectedId ? 'active' : ''}`} onClick={() => setPicked(o.id)}>{o.name}</button>
          ))}
        </div>
      )}
      <div className="pills" role="tablist" aria-label="Anno">
        {s.years.map(yy => (
          <button key={yy} type="button" role="tab" aria-selected={yy === y} className={`pill ${yy === y ? 'active' : ''}`} onClick={() => setYear(yy)}>{yy}</button>
        ))}
      </div>
      <div className="pills" role="tablist" aria-label="Cambi">
        <button type="button" role="tab" aria-selected={mode === 'bdi'} className={`pill ${mode === 'bdi' ? 'active' : ''}`} onClick={() => setMode('bdi')}>Cambi Banca d’Italia</button>
        <button type="button" role="tab" aria-selected={mode === 'ibkr'} className={`pill ${mode === 'ibkr' ? 'active' : ''}`} onClick={() => setMode('ibkr')}>Cambi IBKR</button>
      </div>

      <StatementImport pid={s.selectedId} year={s.year} portfolio={s.portfolio} statement={s.statement} closesUsed={d?.closesFromStatement ?? null} />

      {s.grants.length > 0 && <BonusCard grants={s.grants} portfolio={s.portfolio} />}

      {!d ? (
        <div className="card skeleton" style={{ height: 240 }} aria-busy="true" />
      ) : (
        <>
          {d.provisional && (
            <div className="card warn">
              <b>Anno in corso: bozza provvisoria.</b> Mancano le vendite e i dividendi fino al 31/12; per il quadro RW si usano i prezzi
              e i cambi di oggi invece di quelli di fine anno. Dal 1° gennaio {y + 1} il prospetto si aggiorna da solo con i valori veri.
            </div>
          )}
          {d.issues.length > 0 && (
            <div className="card warn">
              {d.issues.length} problemi nei dati possono falsare i numeri (vedi l’elenco in fondo alla pagina Fiscale).
            </div>
          )}

          <div className="kpis">
            <Kpi label="Plusvalenze (RT)" value={eur(d.rt.taxEur)} hint="F24 codice 1100" />
            <Kpi label="Redditi esteri (RM)" value={eur(d.rm.taxEur)} />
            <Kpi label="IVAFE (RW)" value={eur(d.rw.ivafeEur)} />
            <Kpi label="Totale da versare" value={eur(d.rt.taxEur + d.rm.taxEur + d.rw.ivafeEur)} hint="saldo a giugno, senza acconti" />
          </div>

          <div className="card">
            <h2>Quadro RT — plusvalenze (sezione II-A, 26%)</h2>
            <FieldList fields={fields!.RT} />
            {d.rt.etfGains.length > 0 && <p className="muted small">Le plus di ETF e fondi ({d.rt.etfGains.length}) non sono qui: sono redditi di capitale e vanno nel quadro RM, lettera B. Le loro minus invece restano qui.</p>}
            {d.rt.crypto && <p className="warn-text small">Cripto-attività: {d.rt.crypto.count} vendite, risultato {eur(d.rt.crypto.netEur, true)}. Vanno nella sezione V-A (33%): non compilata da questo prospetto.</p>}
            {d.rt.priorLosses.length > 0 && (
              <details>
                <summary>Minus degli anni precedenti</summary>
                <ul className="plain-list">
                  {d.rt.priorLosses.map(p => (
                    <li key={p.year}>
                      <span>Del {p.year}{p.manual ? ' (inserite a mano)' : ''}<br /><small className="muted">usabili fino al {p.expiresYear}</small></span>
                      <span className="num">disponibili {eur(p.availableEur)}<br /><small className="muted">usate {eur(p.usedEur)} · restano {eur(p.carriedEur)}</small></span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <details>
              <summary>Dettaglio delle {d.rt.sales.length} vendite</summary>
              <ul className="fiscal-lines">
                {d.rt.sales.map(x => (
                  <li key={x.key}>
                    <div><b>{x.assetName}</b>{x.side === 'short' && <span className="badge">short</span>}{x.bond && <span className="badge">48,08%</span>}<br /><small className="muted">{it(x.date)}</small></div>
                    <div className="num"><span>{eur(x.gainEur, true)}</span><small className="muted">incasso {eur(x.proceedsEur)} · costo {eur(x.costEur)}</small></div>
                  </li>
                ))}
              </ul>
            </details>
          </div>

          <div className="card">
            <h2>Quadro RM — redditi di capitale esteri (rigo RM31)</h2>
            {d.rm.rows.length === 0 ? <p className="muted">Nessun dividendo o interesse nel {y}.</p> : <FieldList fields={fields!.RM} />}
            {d.rm.rows.map(r => (
              <details key={r.letter + r.iso}>
                <summary>{r.letter} — {RM_LETTERS[r.letter]} · {r.country?.name ?? r.iso ?? 'Stato non noto'}: {eur(r.grossEur)}</summary>
                <ul className="fiscal-lines">
                  {r.items.map((x, i) => (
                    <li key={i}>
                      <div><b>{x.label}</b><br /><small className="muted">{it(x.date)}</small></div>
                      <div className="num"><span>{eur(x.grossEur)}</span>{x.withholdingEur > 0.005 && <small className="muted">ritenuta estera {eur(x.withholdingEur)}</small>}</div>
                    </li>
                  ))}
                </ul>
              </details>
            ))}
            {d.rm.withholdingEur > 0.005 && (
              <p className="muted small">
                Ritenute estere pagate: {eur(d.rm.withholdingEur)}. Non si scalano (colonna 5 vuota): le istruzioni negano il credito
                sull’imposta sostitutiva. Punto da confermare col commercialista.
              </p>
            )}
            <p className="muted small">Interessi e prestito titoli: Stato del broker (IBKR Ireland per i clienti italiani; controlla sul tuo contratto).</p>
          </div>

          <div className="card">
            <h2>Quadro RW — titoli all’estero e IVAFE</h2>
            {d.rw.holdings.length === 0 ? <p className="muted">Nessun titolo posseduto nel {y}.</p> : <FieldList fields={fields!.RW} />}
            <p className="muted small">
              Un solo rigo per tutto il deposito titoli (codice 20): le istruzioni lo permettono per prodotti con lo stesso codice e Stato,
              purché si conservi il prospetto dei singoli titoli qui sotto. Valori a prezzo di mercato, in euro al cambio medio mensile
              della Banca d’Italia.
            </p>
            <details>
              <summary>Prospetto dei {d.rw.holdings.length} titoli (da conservare)</summary>
              <ul className="fiscal-lines">
                {d.rw.holdings.map(h => (
                  <li key={h.assetId}>
                    <div>
                      <b>{h.symbol}</b> <small className="muted">{h.isin ?? ''}</small>
                      <br />
                      <small className="muted">{h.pieces.map(p => `${qty(p.qty)} dal ${it(p.start)} al ${it(p.end)}`).join(' · ')}</small>
                      {h.missing.length > 0 && <><br /><small className="neg">manca: {h.missing.join(', ')}</small></>}
                    </div>
                    <div className="num">
                      <span>{eur(h.endEur)}</span>
                      <small className="muted">iniziale {eur(h.startEur)} · {h.days} gg · IVAFE {eur(h.ivafeEur)}</small>
                    </div>
                  </li>
                ))}
              </ul>
            </details>
            <h3>Conto corrente (codice 1)</h3>
            <p className="small">
              {d.cashNowEur != null && <>Saldo di cassa attuale: <b>{eur(d.cashNowEur)}</b>{d.cashNowEur < 0 ? ' (a debito per il margine)' : ''}. </>}
              {d.rw.cash.note}{d.cashNowEur != null ? ' (stima fatta sul saldo di oggi, non sulla media dell’anno)' : ''} Serve la <b>giacenza media dell’anno</b>, che si legge sul rendiconto annuale IBKR: sotto 5.000 € l’IVAFE del conto non è dovuta;
              il conto va comunque indicato (solo monitoraggio) se nell’anno ha superato 15.000 €.
            </p>
          </div>

          <div className="card">
            <h2>Cambi: Banca d’Italia o IBKR?</h2>
            <p className="small">
              Imposta sulle plusvalenze con i cambi {mode === 'bdi' ? 'IBKR' : 'Banca d’Italia'}: <b>{eur(d.rtOther.taxEur)}</b> (plusvalenza {eur(d.rtOther.netEur, true)}),
              contro <b>{eur(d.rt.taxEur)}</b> (plusvalenza {eur(d.rt.netEur, true)}) di questo prospetto.
              Redditi esteri: {eur(d.rmOther.grossEur)} contro {eur(d.rm.grossEur)}.
            </p>
            <p className="muted small">
              La legge chiede il cambio del giorno dell’operazione: di solito si usa quello ufficiale della Banca d’Italia (scelto di base).
              Il cambio effettivo applicato da IBKR è un’alternativa diffusa: scegline uno e usalo per tutto l’anno.
            </p>
            {d.compare.length > 0 && (
              <details>
                <summary>{d.compare.length} movimenti in valuta, differenza più grande {Math.max(...d.compare.map(c => Math.abs(c.diffPct))).toFixed(2)}%</summary>
                <ul className="fiscal-lines">
                  {d.compare.map(c => (
                    <li key={c.key}>
                      <div><b>{c.symbol}</b> <small className="muted">{c.type}</small><br /><small className="muted">{it(c.date)} · {money(c.amountNative, c.currency)}</small></div>
                      <div className="num"><span>{eur(c.diffEur, true)}</span><small className="muted">IBKR {c.savedRate.toFixed(4)} · BdI {c.bdiRate.toFixed(4)}</small></div>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>

          <div className="tax-actions">
            <button type="button" className="btn btn-primary" onClick={() => void navigator.clipboard?.writeText(allText)}>Copia tutto il prospetto</button>
            <button type="button" className="btn btn-ghost" onClick={() => window.print()}>Stampa / PDF</button>
          </div>
          <p className="muted small">
            Calcolato dai movimenti registrati nell’app (LIFO, costo in euro al cambio di ogni operazione). Non sostituisce il commercialista:
            confronta i totali con il rendiconto annuale di IBKR prima di presentare la dichiarazione. Le regole sono in docs/regole-fiscali.md.
          </p>
        </>
      )}
    </section>
  )
}
