import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Kpi, PortfolioPicker } from '../components/PortfolioPicker'
import { useComputedPortfolio } from '../data/useComputedPortfolio'
import { usePortfolioEdit } from '../data/usePortfolioEdit'
import { useSimCart } from '../data/useSimCart'
import { symbolOf } from '../domain/engine/valuation'
import { opsToTxs, previewOp, qtyForBudget, qtyForProceeds, simulate, simulateExtras, simulateSteps, spends, trailingDividend, type OpPreview } from '../domain/simulation'
import { CartList, CartTotalsBox } from '../components/SimCart'
import { loadDividends } from '../lib/dividends'
import { EDITABLE_LABEL, type EditableType } from '../domain/txEdit'
import { eur, money, qty as fmtQty, tone } from '../lib/format'
import { localToday } from '../lib/today'

const TODAY = localToday()
const num = (s: string) => Number(s.trim().replace(',', '.'))

/**
 * Pagina Simulatore. `embedded`: dentro la finestra aperta dai pulsanti sulla riga in Posizioni,
 * già sul titolo e sull'operazione scelti (senza titolo di pagina e scelta del portafoglio).
 */
export function Simulator({ presetAssetId, presetType, embedded }: { presetAssetId?: string; presetType?: EditableType; embedded?: boolean } = {}) {
  const c = useComputedPortfolio()
  const [ops, setOps] = useSimCart(c.status === 'ready' ? c.selectedId : null)
  const [assetId, setAssetId] = useState(presetAssetId ?? '')
  const [type, setType] = useState<EditableType>(presetType ?? 'buy')
  const [mode, setMode] = useState<'qty' | 'budget'>('qty')
  const [budget, setBudget] = useState('')
  const [qty, setQty] = useState('')
  const [price, setPrice] = useState('')
  const [commission, setCommission] = useState('')
  const [error, setError] = useState('')
  const edit = usePortfolioEdit()
  const [saveDate, setSaveDate] = useState(TODAY)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)
  /** Dividendo per azione degli ultimi 12 mesi, per simbolo (Yahoo). */
  const [dps, setDps] = useState<Record<string, number>>({})

  const sim = useMemo(
    () => (c.status === 'ready' && ops.length ? simulate({ portfolio: c.portfolio, fx: c.fx, latestFx: c.latestFx, ops, today: TODAY }) : null),
    [c, ops],
  )
  // Effetto di ogni riga nell'ordine del carrello (imposta, netto, nuovo PMC), come nel sito vecchio.
  const steps = useMemo(
    () => (c.status === 'ready' && ops.length ? simulateSteps({ portfolio: c.portfolio, fx: c.fx, latestFx: c.latestFx, ops, today: TODAY }) : null),
    [c, ops],
  )

  const simSymbols = sim ? sim.assets.map(a => a.symbol).filter(x => !(x in dps)).join(',') : ''
  useEffect(() => {
    if (!simSymbols) return
    let alive = true
    loadDividends(simSymbols.split(','))
      .then(byTicker => alive && setDps(d => ({ ...d, ...Object.fromEntries(simSymbols.split(',').map(x => [x, trailingDividend(byTicker[x] ?? [], TODAY)])) })))
      .catch(() => alive && setDps(d => ({ ...d, ...Object.fromEntries(simSymbols.split(',').map(x => [x, 0])) })))
    return () => {
      alive = false
    }
  }, [simSymbols])

  if (c.status === 'loading') return <section className="page"><h1>Simulatore</h1><div className="card skeleton" style={{ height: 240 }} /></section>
  if (c.status === 'error') return <section className="page"><h1>Simulatore</h1><div className="card error">{c.message}</div></section>
  if (c.status === 'empty') return <section className="page"><h1>Simulatore</h1><div className="card">Nessun portafoglio.</div></section>

  const assets = Object.entries(c.portfolio.assets ?? {})
    .map(([id, a]) => ({ id, label: symbolOf(a, id), currency: (a.valuta || 'EUR').toUpperCase() }))
    .sort((a, b) => a.label.localeCompare(b.label))
  const current = assets.find(a => a.id === assetId) ?? assets[0]
  const row = current ? c.rows.find(r => r.assetId === current.id) : undefined
  const quote = row?.price != null && row.currency === current?.currency ? row.price : null
  const held = c.result.positions[current?.id ?? '']?.qty ?? 0
  /** Quantità massima sensata: tutto ciò che si ha (vendita) o tutto lo short (chiusura). */
  const max = type === 'sell' ? Math.max(held, 0) : type === 'buy_to_cover' ? Math.max(-held, 0) : 0

  const rate = current ? (current.currency === 'EUR' ? 1 : c.latestFx[current.currency] ?? NaN) : NaN
  const priceNow = price.trim() ? num(price) : quote ?? NaN
  const commNow = commission.trim() ? num(commission) : 0
  const budgetQty = mode !== 'budget' ? 0 : spends(type) ? qtyForBudget(num(budget), priceNow, rate, commNow) : qtyForProceeds(num(budget), priceNow, rate, commNow)
  const qtyNow = mode === 'budget' ? budgetQty : num(qty)
  // Anteprima in tempo reale (come nel sito vecchio): cosa succede aggiungendo questa operazione al carrello.
  const preview =
    current && qtyNow > 0 && Number.isFinite(priceNow) && priceNow > 0 && Number.isFinite(commNow) && commNow >= 0
      ? previewOp({ portfolio: c.portfolio, fx: c.fx, latestFx: c.latestFx, today: TODAY, cart: ops, op: { id: 'anteprima', assetId: current.id, type, qty: qtyNow, price: priceNow, commissionEur: commNow } })
      : null
  /** Valore in euro al prezzo di oggi (o a quello scritto, se non c'è quotazione). */
  const valueEur = (q: number) => (Number.isFinite(rate) && rate > 0 ? (q * (quote ?? priceNow)) / rate : null)

  function add() {
    if (!current) return
    const q = qtyNow
    const p = priceNow
    const comm = commNow
    if (mode === 'budget' && !(num(budget) > 0)) return setError(spends(type) ? 'Scrivi il budget in euro.' : 'Scrivi quanto vuoi incassare, in euro.')
    if (preview?.issue) return setError(preview.issue)
    if (!(q > 0)) return setError('La quantità deve essere maggiore di zero.')
    if (!Number.isFinite(p) || p < 0) return setError('Scrivi il prezzo: non c’è una quotazione da usare.')
    if (!Number.isFinite(comm) || comm < 0) return setError('Le commissioni non sono valide.')
    setError('')
    setOps(o => [...o, { id: Math.random().toString(36).slice(2, 8), assetId: current.id, type, qty: q, price: p, commissionEur: comm }])
    setQty('')
  }

  /** Salva le operazioni del carrello come movimenti veri e svuota il carrello. */
  async function register() {
    if (!sim || sim.issues.length) return
    const valid = ops.filter(o => sim.ops.some(r => r.op.id === o.id))
    if (!valid.length) return
    const day = new Date(saveDate + 'T12:00:00').toLocaleDateString('it-IT')
    if (!confirm(`Registrare ${valid.length} ${valid.length === 1 ? 'operazione' : 'operazioni'} come movimenti del ${day}? Il prezzo resta "da confermare" finché non inserisci quello eseguito.`)) return
    setSaving(true)
    setError('')
    const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
    try {
      for (const { assetId: aid, tx } of opsToTxs(valid, saveDate, newId)) await edit.add(c.status === 'ready' ? c.selectedId : '', aid, tx)
      setOps([])
      setSaved(`${valid.length} ${valid.length === 1 ? 'movimento registrato' : 'movimenti registrati'} il ${day}.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Salvataggio non riuscito: controlla la connessione e riprova.')
    } finally {
      setSaving(false)
    }
  }

  const extras = sim
    ? simulateExtras({
        sim,
        regime: c.result.regime,
        prices: Object.fromEntries(sim.assets.map(a => {
          const r = c.rows.find(x => x.assetId === a.assetId)
          const lastOp = [...ops].reverse().find(o => o.assetId === a.assetId)
          return [a.assetId, r?.price ?? lastOp?.price ?? null]
        })),
        latestFx: c.latestFx,
        dividendPerShare: Object.fromEntries(sim.assets.map(a => [a.assetId, dps[a.symbol]])),
        today: TODAY,
      })
    : null

  const label = (txId?: string) => {
    const op = ops.find(o => `sim#${o.id}` === txId)
    return op ? assets.find(a => a.id === op.assetId)?.label ?? op.assetId : ''
  }

  return (
    <section className={embedded ? 'sim-embedded' : 'page'}>
      {!embedded && <header className="page-head">
        <h1>Simulatore</h1>
        <PortfolioPicker options={c.options} selectedId={c.selectedId} onSelect={id => { c.select(id); setAssetId('') }} />
        <p className="muted small">
          Prova acquisti e vendite prima di farli: vedi il nuovo PMC, la plus o minus e le tasse stimate con le minus disponibili.
          Non salva nulla finché non tocchi "Registra come movimenti".
          {c.result.regime === 'dichiarativo' ? ' Dichiarativo: costo LIFO.' : ' Amministrato: costo medio.'}
        </p>
      </header>}

      <form className="card note-form" onSubmit={e => { e.preventDefault(); add() }}>
        {!embedded && <h2>Nuova operazione</h2>}
        <div className="pills" role="radiogroup" aria-label="Tipo">
          {(Object.keys(EDITABLE_LABEL) as EditableType[]).map(t => (
            <button key={t} type="button" role="radio" aria-checked={type === t} className={`pill small-pill ${type === t ? 'active' : ''}`} onClick={() => setType(t)}>
              {EDITABLE_LABEL[t]}
            </button>
          ))}
        </div>
        <label>
          Titolo
          <select value={current?.id ?? ''} onChange={e => { setAssetId(e.target.value); setPrice('') }}>
            {assets.map(a => <option key={a.id} value={a.id}>{a.label} ({a.currency})</option>)}
          </select>
        </label>
        {current && (
          <p className="muted small">
            In portafoglio: {fmtQty(held)}
            {quote !== null && <> · prezzo attuale {money(quote, current.currency)}</>}
          </p>
        )}
        <div className="pills" role="radiogroup" aria-label="Come scegliere la quantità">
          <button type="button" role="radio" aria-checked={mode === 'qty'} className={`pill small-pill ${mode === 'qty' ? 'active' : ''}`} onClick={() => setMode('qty')}>Per quantità</button>
          <button type="button" role="radio" aria-checked={mode === 'budget'} className={`pill small-pill ${mode === 'budget' ? 'active' : ''}`} onClick={() => setMode('budget')}>Per budget</button>
        </div>
        <div className="form-row">
          {mode === 'budget' ? (
            <label>
              {spends(type) ? 'Budget da spendere (€)' : 'Somma da incassare (€)'}
              <input inputMode="decimal" value={budget} onChange={e => setBudget(e.target.value)} />
              <small className="muted">{budgetQty > 0 ? `= ${fmtQty(budgetQty)} azioni` : spends(type) ? 'quante azioni intere compri' : 'quante azioni intere vendi'}</small>
            </label>
          ) : (
            <label>
              Quantità
              <span className="inline-pair">
                <input inputMode="decimal" value={qty} onChange={e => setQty(e.target.value)} />
                {max > 0 && <button type="button" className="btn btn-ghost" onClick={() => setQty(String(max))}>MAX</button>}
              </span>
            </label>
          )}
          <label>
            Prezzo ({current?.currency ?? 'EUR'})
            <input inputMode="decimal" value={price} onChange={e => setPrice(e.target.value)} placeholder={quote !== null ? String(quote) : ''} />
          </label>
        </div>
        <label>Commissioni (€)<input inputMode="decimal" value={commission} onChange={e => setCommission(e.target.value)} placeholder="0" /></label>
        {current && <SimPreview p={preview} currency={current.currency} type={type} budgetLeft={mode === 'budget' && spends(type) && preview ? num(budget) + preview.netEur : null} valueEur={valueEur} />}
        <p className="auth-error" role="alert">{error}</p>
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={!preview || !!preview.issue}>Aggiungi al carrello</button>
        </div>
      </form>

      {saved && (
        <div className="card" role="status">
          {saved} <Link to="/movimenti">Vedi i movimenti</Link>{' '}
          <button type="button" className="linklike" onClick={() => setSaved(null)}>Chiudi</button>
        </div>
      )}

      {ops.length > 0 && sim && (
        <>
          <div className="card">
            <div className="row-head">
              <h2>Carrello ({ops.length})</h2>
              <button type="button" className="linklike neg" onClick={() => { if (confirm('Svuotare il carrello?')) setOps([]) }}>Svuota</button>
            </div>
            <CartList sim={sim} steps={steps} setOps={setOps} />
            {steps && <CartTotalsBox ops={ops} steps={steps} />}
          </div>

          {sim.issues.length > 0 && (
            <div className="card error" role="alert">
              {sim.issues.map((i, k) => <div key={k}>{label(i.txId)}: {i.message}</div>)}
            </div>
          )}

          <div className="kpis">
            <Kpi label="Plus/minus realizzate" value={eur(sim.gainEur, true)} className={tone(sim.gainEur)} />
            <Kpi label={`Imposta ${sim.year} (stima)`} value={eur(sim.taxEur, true)} hint={sim.taxEur < 0 ? 'risparmio' : '26%, 12,5% titoli di Stato, 33% crypto'} />
            <Kpi label="Minus usate" value={eur(sim.lossesUsedEur)} hint={`disponibili: ${eur(sim.lossesBeforeEur)} → ${eur(sim.lossesAfterEur)}`} />
            <Kpi label="Cassa netta" value={eur(sim.cashEur, true)} className={tone(sim.cashEur)} hint={`commissioni ${eur(sim.commissionsEur)}, al netto delle tasse`} />
          </div>

          <div className="card">
            <h2>Prima e dopo</h2>
            <ul className="plain-list before-after">
              {sim.assets.map(a => (
                <li key={a.assetId}>
                  <b>{a.symbol}</b>
                  <span>Quantità {fmtQty(a.before.qty)} → <b>{fmtQty(a.after.qty)}</b></span>
                  <span>PMC {money(a.before.pmcNative, a.currency)} → <b>{money(a.after.pmcNative, a.currency)}</b></span>
                  <span>Costo totale {eur(a.before.costEur)} → <b>{eur(a.after.costEur)}</b></span>
                </li>
              ))}
            </ul>
            <p className="muted small">Il carrello resta salvato per questo portafoglio (anche sugli altri dispositivi) finché non lo svuoti o registri le operazioni.</p>
            <p className="muted small">Stima con le regole del portafoglio scelto, ai cambi più recenti.</p>
          </div>

          {extras && (
            <div className="card">
              <h2>Altri effetti</h2>
              <ul className="plain-list">
                <li>
                  <span>{extras.wealthKind === 'ivafe' ? 'IVAFE' : 'Imposta di bollo'} (2‰ sul valore dei titoli)<br /><small className="muted">quest'anno, per i giorni che restano: {eur(extras.wealthThisYearDeltaEur, true)}</small></span>
                  <b className={tone(-extras.wealthYearDeltaEur)}>{eur(extras.wealthYearDeltaEur, true)} l'anno</b>
                </li>
                <li>
                  <span>Dividendi attesi (ultimi 12 mesi)<br /><small className="muted">lordi {eur(extras.dividendsGrossDeltaEur, true)}; netti di ritenuta estera e 26%</small></span>
                  <b className={tone(extras.dividendsNetDeltaEur)}>{eur(extras.dividendsNetDeltaEur, true)} l'anno</b>
                </li>
              </ul>
              {extras.missing.length > 0 && <p className="muted small">Senza prezzo o cambio di oggi, esclusi: {extras.missing.join(', ')}.</p>}
              <p className="muted small">Stime: bollo/IVAFE sul valore di oggi (quello vero è al 31/12), dividendi uguali a quelli degli ultimi 12 mesi.</p>
            </div>
          )}

          <div className="card note-form">
            <h2>Hai eseguito queste operazioni?</h2>
            <p className="muted small">
              Salvale come movimenti veri, con il prezzo simulato segnato "da confermare". Sul conto IBKR la sincronizzazione le collega
              all'ordine eseguito (stesso giorno, tipo e quantità) e corregge prezzo e commissioni.
            </p>
            <label>Data<input type="date" value={saveDate} max={TODAY} onChange={e => setSaveDate(e.target.value)} /></label>
            <div className="form-actions">
              <button type="button" className="btn btn-primary" disabled={saving || sim.issues.length > 0 || !sim.ops.length} onClick={() => void register()}>
                {saving ? 'Salvo…' : 'Registra come movimenti'}
              </button>
            </div>
            {sim.issues.length > 0 && <p className="muted small">Prima correggi le operazioni segnalate in rosso.</p>}
          </div>
        </>
      )}
    </section>
  )
}

/** Riquadro "Anteprima": prima e dopo (quantità, PMC, costo di carico, valore) ed effetto dell'operazione. */
function SimPreview({ p, currency, type, budgetLeft, valueEur }: { p: OpPreview | null; currency: string; type: EditableType; budgetLeft: number | null; valueEur: (q: number) => number | null }) {
  if (!p) return <div className="sim-preview"><div className="sim-preview-title">Anteprima</div><p className="muted small sim-preview-empty">Scrivi quantità (o somma) e prezzo: qui vedi subito come cambia la posizione.</p></div>
  if (p.issue) return <div className="sim-preview"><div className="sim-preview-title">Anteprima</div><p className="neg small sim-preview-empty">{p.issue}</p></div>
  const delta = (a: number, b: number, f: (n: number) => string) => (Math.abs(b - a) > 1e-9 ? <small>{b > a ? '+' : '−'}{f(Math.abs(b - a))}</small> : null)
  const pmc = (n: number) => money(n, currency)
  const vb = valueEur(p.before.qty)
  const va = valueEur(p.after.qty)
  const sells = !spends(type)
  return (
    <div className="sim-preview" aria-live="polite">
      <div className="sim-preview-title"><span>Anteprima</span><span>si aggiorna mentre scrivi</span></div>
      <table>
        <thead><tr><th>Posizione</th><th>Prima</th><th className="after">Dopo</th></tr></thead>
        <tbody>
          <tr><td>Quantità</td><td>{fmtQty(p.before.qty)}</td><td className="after">{fmtQty(p.after.qty)}{delta(p.before.qty, p.after.qty, fmtQty)}</td></tr>
          <tr><td>{p.after.qty < 0 ? 'Prezzo medio short' : 'PMC'}</td><td>{pmc(p.before.pmcNative)}</td><td className="after">{pmc(p.after.pmcNative)}{delta(p.before.pmcNative, p.after.pmcNative, pmc)}</td></tr>
          <tr><td>Costo di carico</td><td>{eur(p.before.costEur)}</td><td className="after">{eur(p.after.costEur)}{delta(p.before.costEur, p.after.costEur, eur)}</td></tr>
          {vb !== null && va !== null && <tr><td>Valore (prezzo attuale)</td><td>{eur(vb)}</td><td className="after">{eur(va)}{delta(vb, va, eur)}</td></tr>}
        </tbody>
      </table>
      <dl className="sim-preview-op">
        {sells && p.gainEur !== null && <div><dt>Plus/minus lorda</dt><dd className={tone(p.gainEur)}>{eur(p.gainEur, true)}</dd></div>}
        {(sells || Math.abs(p.taxEur) >= 0.005) && <div><dt>Imposta stimata{p.taxEur < 0 ? ' (risparmio)' : ''}</dt><dd>{eur(p.taxEur, true)}</dd></div>}
        {sells && p.gainEur !== null && <div><dt>Guadagno netto</dt><dd className={tone(p.gainEur - p.taxEur)}>{eur(p.gainEur - p.taxEur, true)}</dd></div>}
        <div className="big"><dt>{p.netEur < 0 ? 'Spendi' : 'Incassi netti'}</dt><dd>{eur(Math.abs(p.netEur))}</dd></div>
        {budgetLeft !== null && <div className="muted"><dt>Avanzano dal budget</dt><dd>{eur(budgetLeft)}</dd></div>}
      </dl>
    </div>
  )
}
