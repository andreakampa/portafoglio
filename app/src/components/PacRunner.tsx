import { useEffect, useRef, useState } from 'react'
import { usePacPlans } from '../data/usePacPlans'
import { usePortfolioEdit } from '../data/usePortfolioEdit'
import { usePortfolioState } from '../data/usePortfolioState'
import type { RawAsset, RawTx } from '../domain/engine/types'
import { symbolOf } from '../domain/engine/valuation'
import { buildPacTx, dueDates, executionOn } from '../domain/pac'
import { loadCloses } from '../lib/priceHistory'
import { localToday } from '../lib/today'

type PlanAsset = RawAsset & { transactions?: RawTx[] }

/**
 * Genera da sola le rate dei piani PAC maturate (fino a ieri), al prezzo di chiusura di borsa.
 * Gira all'apertura dell'app e a ogni cambio dei dati; la scrittura è una transazione, quindi non crea doppioni.
 */
export function PacRunner() {
  const state = usePortfolioState()
  const { plans } = usePacPlans()
  const edit = usePortfolioEdit()
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const tried = useRef(new Set<string>())
  const busy = useRef(false)

  useEffect(() => {
    if (state.status !== 'ready' || !plans?.length || busy.current) return
    const portfolios = state.data?.portfolios as Record<string, { assets?: Record<string, PlanAsset> }> | undefined
    const today = localToday()
    const work = plans.flatMap(plan => {
      const asset = portfolios?.[plan.portfolioId]?.assets?.[plan.assetId]
      if (!asset) return []
      return dueDates(plan, asset.transactions ?? [], today)
        .filter(d => !tried.current.has(`${plan.id}:${d}`))
        .map(date => ({ plan, asset, date }))
    })
    if (!work.length) return

    busy.current = true
    void (async () => {
      let added = 0
      const failures: string[] = []
      const closesBy = new Map<string, Record<string, number>>()
      for (const { plan, asset, date } of work) {
        const symbol = symbolOf(asset, plan.assetId)
        try {
          if ((asset.valuta || 'EUR').toUpperCase() !== 'EUR') throw new Error('titolo non in euro')
          if (!closesBy.has(symbol)) closesBy.set(symbol, await loadCloses(symbol))
          const exec = executionOn(closesBy.get(symbol)!, date, today)
          if (!exec) continue // prezzo non ancora disponibile: si riprova alla prossima apertura
          const tx = buildPacTx(plan, date, exec, () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8))
          if (await edit.addPacRate(plan.portfolioId, plan.assetId, tx, plan.id, date)) added += 1
          tried.current.add(`${plan.id}:${date}`)
        } catch (e) {
          tried.current.add(`${plan.id}:${date}`)
          failures.push(`${symbol} ${date}: ${e instanceof Error ? e.message : 'errore'}`)
        }
      }
      busy.current = false
      if (failures.length) setMessage({ kind: 'error', text: `PAC: ${failures.length} rata/e non create (${failures.slice(0, 2).join('; ')}). Riprova riaprendo l'app.` })
      else if (added) setMessage({ kind: 'ok', text: `PAC: ${added} ${added === 1 ? 'rata aggiunta' : 'rate aggiunte'} (prezzo di chiusura, da confermare con l'esecuzione vera).` })
    })()
  }, [state, plans, edit])

  if (!message) return null
  return (
    <div className={`card ${message.kind === 'error' ? 'error' : ''}`} role={message.kind === 'error' ? 'alert' : 'status'}>
      {message.text} <button type="button" className="linklike" onClick={() => setMessage(null)}>Chiudi</button>
    </div>
  )
}
