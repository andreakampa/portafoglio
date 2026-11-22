import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Kpi, PortfolioPicker } from '../components/PortfolioPicker'
import { useComputedPortfolio } from '../data/useComputedPortfolio'
import { usePortfolioEdit } from '../data/usePortfolioEdit'
import { symbolOf } from '../domain/engine/valuation'
import { opsToTxs, simulate, simulateExtras, trailingDividend, type SimOp } from '../domain/simulation'
import { loadDividends } from '../lib/dividends'
import { EDITABLE_LABEL, type EditableType } from '../domain/txEdit'
import { eur, money, qty as fmtQty, tone } from '../lib/format'

const TODAY = new Date().toISOString().slice(0, 10)
const num = (s: string) => Number(s.trim().replace(',', '.'))

export function Simulator() {
  const c = useComputedPortfolio()
  const [ops, setOps] = useState<SimOp[]>([])
  const [assetId, setAssetId] = useState('')
  const [type, setType] = useState<EditableType>('buy')
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

  function add() {
    if (!current) return
    const q = num(qty)
    const p = price.trim() ? num(price) : quote ?? NaN
    const comm = commission.trim() ? num(commission) : 0
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
    <section className="page">
      <header className="page-head">
        <h1>Simulatore</h1>
        <PortfolioPicker options={c.options} selectedId={c.selectedId} onSelect={id => { c.select(id); setOps([]); setAssetId('') }} />
        <p className="muted small">
          Prova acquisti e vendite prima di farli: vedi il nuovo PMC, la plus o minus e le tasse stimate con le minus disponibili.
          Non salva nulla finché non tocchi "Registra come movimenti".
          {c.result.regime === 'dichiarativo' ? ' Dichiarativo: costo LIFO.' : ' Amministrato: costo medio.'}
        </p>
      </header>

      <form className="card note-form" onSubmit={e => { e.preventDefault(); add() }}>
        <h2>Nuova operazione</h2>
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
        <div className="form-row">
          <label>
            Quantità
            <span className="inline-pair">
              <input inputMode="decimal" value={qty} onChange={e => setQty(e.target.value)} />
              {max > 0 && <button type="button" className="btn btn-ghost" onClick={() => setQty(String(max))}>MAX</button>}
            </span>
          </label>
          <label>
            Prezzo ({current?.currency ?? 'EUR'})
            <input inputMode="decimal" value={price} onChange={e => setPrice(e.target.value)} placeholder={quote !== null ? String(quote) : ''} />
          </label>
        </div>
        <label>Commissioni (€)<input inputMode="decimal" value={commission} onChange={e => setCommission(e.target.value)} placeholder="0" /></label>
        <p className="auth-error" role="alert">{error}</p>
        <div className="form-actions">
          <button type="submit" className="btn btn-primary">Aggiungi al carrello</button>
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
              <button type="button" className="linklike neg" onClick={() => setOps([])}>Svuota</button>
            </div>
            <ul className="plain-list">
              {sim.ops.length === 0 && <li className="muted">Operazioni non valide.</li>}
              {sim.ops.map(r => (
                <li key={r.op.id}>
                  <span>
                    <b>{r.symbol}</b> · {EDITABLE_LABEL[r.op.type]} {fmtQty(r.op.qty)} × {money(r.op.price, r.currency)}
                    <span className="muted"> = {money(r.grossNative, r.currency)}</span>
                  </span>
                  <span className="note-actions">
                    {r.gainEur !== null && <b className={tone(r.gainEur)}>{eur(r.gainEur, true)}</b>}
                    <button type="button" className="linklike neg" onClick={() => setOps(o => o.filter(x => x.id !== r.op.id))}>Togli</button>
                  </span>
                </li>
              ))}
            </ul>
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
