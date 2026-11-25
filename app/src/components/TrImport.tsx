// Import dell'esportazione delle transazioni di Trade Republic (CSV): anteprima riga per riga, poi si applica.
// Il file non viene salvato: si leggono solo le operazioni sui titoli.
import { useRef, useState } from 'react'
import type { Computed } from '../data/useComputedPortfolio'
import { usePortfolioEdit } from '../data/usePortfolioEdit'
import { symbolOf } from '../domain/engine/valuation'
import { parseTrCsv, planTrImport, type TrAction, type TrMatch, type TrPlan } from '../domain/tradeRepublic'
import { money, qty as fmtQty } from '../lib/format'
import { toast } from '../lib/toast'

type Ready = Extract<Computed, { status: 'ready' }>
const fmtDate = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('it-IT')
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8)

const WHAT: Record<TrAction, string> = {
  replace: 'Sostituisce la stima',
  fix: 'Corregge un movimento confermato',
  new: 'Nuovo (mancava)',
  same: 'Già uguale',
  unknown: 'Titolo non in questo portafoglio',
}
const ACTIVE: TrAction[] = ['replace', 'fix', 'new']
const keyOf = (m: TrMatch) => m.trade.id || `${m.trade.isin}#${m.trade.date}#${m.trade.qty}`

export function TrImport({ c, onClose }: { c: Ready; onClose: () => void }) {
  const edit = usePortfolioEdit()
  const input = useRef<HTMLInputElement>(null)
  const [plan, setPlan] = useState<TrPlan | null>(null)
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const assets = c.portfolio.assets ?? {}
  const sym = (id?: string) => (id && assets[id] ? symbolOf(assets[id], id) : '')

  const onFile = async (file: File | undefined) => {
    if (!file) return
    setError('')
    try {
      const trades = parseTrCsv(await file.text())
      if (!trades.length) throw new Error('Nel file non ci sono acquisti o vendite di titoli.')
      const p = planTrImport(assets as Parameters<typeof planTrImport>[0], trades)
      // Le righe uguali o di titoli assenti non si toccano: si mostrano solo le altre, dalla più recente.
      p.matches.sort((a, b) => b.trade.date.localeCompare(a.trade.date))
      setPlan(p)
      setChosen(new Set(p.matches.filter(m => ACTIVE.includes(m.action)).map(keyOf)))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (input.current) input.current.value = ''
    }
  }

  const apply = async () => {
    if (!plan) return
    const todo = plan.matches.filter(m => ACTIVE.includes(m.action) && chosen.has(keyOf(m)) && m.assetId)
    const byAsset = new Map<string, TrMatch[]>()
    for (const m of todo) byAsset.set(m.assetId!, [...(byAsset.get(m.assetId!) ?? []), m])
    setBusy(true)
    setError('')
    try {
      for (const [aid, list] of byAsset) await edit.applyTr(c.selectedId, aid, list, newId)
      toast(`${todo.length} ${todo.length === 1 ? 'movimento aggiornato' : 'movimenti aggiornati'} da Trade Republic`)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import non riuscito.')
      setBusy(false)
    }
  }

  const count = (a: TrAction) => plan?.matches.filter(m => m.action === a).length ?? 0
  const selected = plan?.matches.filter(m => ACTIVE.includes(m.action) && chosen.has(keyOf(m))).length ?? 0
  const toggle = (k: string) => setChosen(prev => {
    const n = new Set(prev)
    if (n.has(k)) n.delete(k)
    else n.add(k)
    return n
  })

  return (
    <div className="history tr-import">
      <h3>Importa da Trade Republic</h3>
      {!plan && (
        <>
          <p className="muted small">
            Scegli l'esportazione delle transazioni di Trade Republic (file CSV, es. transactions_2026-05-01_2026-11-25.csv). Si leggono solo acquisti e vendite di titoli:
            i movimenti della carta e i bonifici vengono ignorati e il file non viene salvato.
          </p>
          <input ref={input} type="file" accept=".csv,text/csv" onChange={e => void onFile(e.target.files?.[0])} />
        </>
      )}
      {plan && (
        <>
          <p className="muted small">
            Le operazioni del file sono collegate ai movimenti per ISIN, giorno e importo. Il file ha l'ultima parola su quantità,
            prezzo e commissioni. Nulla viene salvato finché non premi Applica.
          </p>
          <div className="tr-chips">
            {(['replace', 'new', 'fix', 'same', 'unknown'] as TrAction[]).filter(count).map(a => (
              <span key={a} className={`badge tr-${a}`}>{count(a)} · {WHAT[a].toLowerCase()}</span>
            ))}
          </div>
          <ul className="confirm-list tr-list">
            {plan.matches.map(m => {
              const k = keyOf(m)
              const active = ACTIVE.includes(m.action)
              return (
                <li key={k} className={active ? '' : 'muted'}>
                  <label>
                    <input type="checkbox" checked={active && chosen.has(k)} disabled={!active} onChange={() => toggle(k)} />
                    <span>
                      {fmtDate(m.trade.date)} · <b>{sym(m.assetId) || m.trade.name}</b> {m.trade.side === 'sell' ? '(vendita)' : ''}
                      <span className="cell-sub">
                        {m.before && <>App: {fmtQty(m.before.qty)} × {money(m.before.price, 'EUR')}{m.before.estimated ? ' (stima)' : ''} → </>}
                        File: {fmtQty(m.trade.qty)} × {money(m.trade.price, 'EUR')}{m.trade.fee ? ` + ${money(m.trade.fee, 'EUR')} comm.` : ''}
                      </span>
                    </span>
                    <span className={`small tr-what tr-${m.action}`}>{WHAT[m.action]}</span>
                  </label>
                </li>
              )
            })}
          </ul>
          {plan.onlyInApp.length > 0 && (
            <p className="muted small">
              Nell'app ma non nel file (non vengono toccati): {plan.onlyInApp.map(x => `${sym(x.assetId)} ${fmtDate(x.date)}`).join(', ')}.
            </p>
          )}
        </>
      )}
      {error && <p className="auth-error" role="alert">{error}</p>}
      <div className="form-actions">
        {plan && (
          <button type="button" className="btn btn-primary" disabled={busy || !selected} onClick={() => void apply()}>
            {busy ? 'Applico…' : `Applica ${selected} ${selected === 1 ? 'modifica' : 'modifiche'}`}
          </button>
        )}
        <button type="button" className="btn btn-ghost" onClick={onClose}>{plan ? 'Annulla' : 'Chiudi'}</button>
      </div>
    </div>
  )
}
