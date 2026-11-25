import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router'
import { useComputedPortfolio } from '../data/useComputedPortfolio'
import { useSelectedPortfolioId } from '../data/selection'
import { usePortfolioState } from '../data/usePortfolioState'
import { useSimCart } from '../data/useSimCart'
import { cartTotals, simulate, simulateSteps, type SimOp, type SimStep, type Simulation } from '../domain/simulation'
import { EDITABLE_LABEL } from '../domain/txEdit'
import { eur, money, qty as fmtQty, tone } from '../lib/format'
import { localToday } from '../lib/today'

/** Righe del carrello: operazione, effetto (imposta e netto o nuovo PMC), ordine ↑↓ e "Togli". */
export function CartList({ sim, steps, setOps }: { sim: Simulation; steps: Map<string, SimStep> | null; setOps: (u: (o: SimOp[]) => SimOp[]) => void }) {
  return (
    <ul className="plain-list">
      {sim.ops.length === 0 && <li className="muted">Operazioni non valide.</li>}
      {sim.ops.map((r, i) => {
        const st = steps?.get(r.op.id)
        const closes = r.op.type === 'sell' || r.op.type === 'buy_to_cover'
        const move = (d: -1 | 1) =>
          setOps(o => {
            const k = o.findIndex(x => x.id === r.op.id)
            const j = k + d
            if (k < 0 || j < 0 || j >= o.length) return o
            const n = [...o]
            ;[n[k], n[j]] = [n[j]!, n[k]!]
            return n
          })
        return (
          <li key={r.op.id} className="cart-row">
            <span>
              <b>{r.symbol}</b> · {EDITABLE_LABEL[r.op.type]} {fmtQty(r.op.qty)} × {money(r.op.price, r.currency)}
              <span className="muted"> = {money(r.grossNative, r.currency)}</span>
              {st && (
                <small className="muted cart-detail">
                  {closes
                    ? <>{r.gainEur !== null && <span className={tone(r.gainEur)}>{eur(r.gainEur, true)}</span>} · imposta {eur(st.taxEur, true)} · netto {eur(st.netEur, true)}</>
                    : <>{st.after.qty < 0 ? 'prezzo medio short' : 'nuovo PMC'} {money(st.after.pmcNative, r.currency)} · {st.netEur < 0 ? 'spesa' : 'incasso'} {eur(Math.abs(st.netEur))}</>}
                </small>
              )}
            </span>
            <span className="note-actions">
              {sim.ops.length > 1 && (
                <>
                  <button type="button" className="linklike" disabled={i === 0} onClick={() => move(-1)} aria-label={`Sposta su ${r.symbol}`} title="Sposta su (conta per l'uso delle minus)">↑</button>
                  <button type="button" className="linklike" disabled={i === sim.ops.length - 1} onClick={() => move(1)} aria-label={`Sposta giù ${r.symbol}`} title="Sposta giù">↓</button>
                </>
              )}
              <button type="button" className="linklike neg" onClick={() => setOps(o => o.filter(x => x.id !== r.op.id))}>Togli</button>
            </span>
          </li>
        )
      })}
    </ul>
  )
}

/** Totali in fondo al carrello: uscite, entrate nette, imposte, saldo. */
export function CartTotalsBox({ ops, steps }: { ops: SimOp[]; steps: Map<string, SimStep> }) {
  const t = cartTotals(ops, steps)
  return (
    <dl className="cart-totals">
      <div><dt>Uscite (acquisti)</dt><dd className="neg">{eur(-t.spentEur)}</dd></div>
      <div><dt>Entrate nette (vendite)</dt><dd className="pos">{eur(t.receivedEur, true)}</dd></div>
      {Math.abs(t.taxEur) >= 0.005 && <div className="muted"><dt>Imposte stimate</dt><dd>{eur(t.taxEur, true)}</dd></div>}
      <div className="cart-grand"><dt>Saldo</dt><dd className={tone(t.balanceEur)}>{eur(t.balanceEur, true)}</dd></div>
    </dl>
  )
}

const TODAY = localToday()

/** Pannello che si apre dal pulsante carrello: calcola il portafoglio solo quando è aperto. */
function CartPanel({ onClose }: { onClose: () => void }) {
  const c = useComputedPortfolio()
  const [ops, setOps] = useSimCart(c.status === 'ready' ? c.selectedId : null)
  const ready = c.status === 'ready'
  const sim = useMemo(() => (ready && ops.length ? simulate({ portfolio: c.portfolio, fx: c.fx, latestFx: c.latestFx, ops, today: TODAY }) : null), [c, ready, ops])
  const steps = useMemo(() => (ready && ops.length ? simulateSteps({ portfolio: c.portfolio, fx: c.fx, latestFx: c.latestFx, ops, today: TODAY }) : null), [c, ready, ops])
  const name = ready ? c.options.find(o => o.id === c.selectedId)?.name : ''
  const [askClear, setAskClear] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <>
      <div className="cart-scrim" onClick={onClose} />
      <div className="cart-drawer" role="dialog" aria-modal="true" aria-labelledby="cart-title">
        <div className="row-head">
          <h2 id="cart-title">Carrello{name ? ` · ${name}` : ''}</h2>
          <button type="button" className="linklike" onClick={onClose}>Chiudi</button>
        </div>
        {!ready && <div className="skeleton" style={{ height: 120 }} />}
        {ready && !ops.length && <p className="muted">Nessuna operazione simulata. Aggiungine una da "Simula" su un titolo o dal Simulatore.</p>}
        {sim && <CartList sim={sim} steps={steps} setOps={setOps} />}
        {sim && sim.issues.length > 0 && <p className="neg small">Alcune operazioni non tornano: aprile nel simulatore per vedere cosa correggere.</p>}
        {sim && steps && <CartTotalsBox ops={ops} steps={steps} />}
        {ops.length > 0 && (
          <div className="form-actions">
            {askClear ? (
              <>
                <span className="small">Svuotare il carrello?</span>
                <button type="button" className="btn btn-ghost" onClick={() => setAskClear(false)}>No</button>
                <button type="button" className="btn btn-danger" onClick={() => { setOps(() => []); setAskClear(false) }}>Sì, svuota</button>
              </>
            ) : (
              <>
                <button type="button" className="btn btn-ghost" onClick={() => setAskClear(true)}>Svuota</button>
                <Link to="/simulatore" className="btn btn-primary" onClick={onClose}>Apri nel simulatore</Link>
              </>
            )}
          </div>
        )}
      </div>
    </>
  )
}

/**
 * Pulsante carrello fisso in basso, su tutte le pagine (come nel sito vecchio), con il numero di operazioni simulate
 * del portafoglio scelto. Non compare se il carrello è vuoto o se sei già nel Simulatore.
 */
export function CartFab() {
  const [stored] = useSelectedPortfolioId()
  const state = usePortfolioState()
  // Stesso portafoglio delle schermate (vedi useComputedPortfolio): quello scelto, altrimenti l'attivo o il primo.
  const ps = state.status === 'ready' ? state.data?.portfolios ?? {} : {}
  const active = state.status === 'ready' ? state.data?.activePortfolioId : undefined
  const pid = stored && ps[stored] ? stored : active && ps[active] ? active : Object.keys(ps)[0] ?? null
  const [ops] = useSimCart(pid)
  const [open, setOpen] = useState(false)
  const { pathname } = useLocation()
  const [bump, setBump] = useState(0)
  const [lastCount, setLastCount] = useState(ops.length)
  if (ops.length !== lastCount) {
    setLastCount(ops.length)
    if (ops.length > lastCount) setBump(b => b + 1)
  }

  if (pathname.startsWith('/simulatore')) return null
  if (!ops.length && !open) return null
  return (
    <>
      <button type="button" className="cart-fab" onClick={() => setOpen(o => !o)} aria-label={`Carrello: ${ops.length} ${ops.length === 1 ? 'operazione' : 'operazioni'}`}>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="9" cy="20" r="1.4" /><circle cx="18" cy="20" r="1.4" /><path d="M2 3h3l2.6 12.2a2 2 0 0 0 2 1.6h8.2a2 2 0 0 0 2-1.5L22 8H6" />
        </svg>
        <span className="cart-fab-label">Carrello</span>
        <span key={bump} className={`cart-badge ${bump ? 'bump' : ''}`}>{ops.length}</span>
      </button>
      {open && <CartPanel onClose={() => setOpen(false)} />}
    </>
  )
}
