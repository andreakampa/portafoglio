import { useEffect, useRef, useState } from 'react'
import { useBonusGrants } from '../data/useBonusGrants'
import { usePortfolioEdit } from '../data/usePortfolioEdit'
import { usePortfolioState } from '../data/usePortfolioState'
import { buildBonusTx, dueGrants, vestingPrice } from '../domain/bonusShares'
import type { RawAsset, RawTx } from '../domain/engine/types'
import { loadCloses } from '../lib/priceHistory'
import { localToday } from '../lib/today'

type Asset = RawAsset & { isin?: string; commDefault?: number }

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8)

/** Titolo del portafoglio per le azioni premio: stesso ISIN e valuta, poi stesso ticker e valuta. */
function assetFor(assets: Record<string, Asset>, isin: string | null, symbol: string, currency: string): string | null {
  const cur = currency.toUpperCase()
  const e = Object.entries(assets)
  const same = (a: Asset) => (a.valuta || 'EUR').toUpperCase() === cur
  return (
    (isin ? e.find(([, a]) => a.isin === isin && same(a)) : undefined)?.[0] ??
    e.find(([, a]) => same(a) && (a.ticker || '').toUpperCase() === symbol.toUpperCase())?.[0] ??
    null
  )
}

/**
 * Registra da sole le azioni premio maturate (dal giorno dopo il vesting), al prezzo di chiusura di quel giorno:
 * è il loro costo fiscale e il reddito da dichiarare nel quadro RM. Scrittura in transazione: niente doppioni.
 */
export function BonusRunner() {
  const state = usePortfolioState()
  const { grants } = useBonusGrants()
  const edit = usePortfolioEdit()
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const tried = useRef(new Set<string>())
  const busy = useRef(false)

  useEffect(() => {
    if (state.status !== 'ready' || !grants || busy.current) return
    const portfolios = state.data?.portfolios as Record<string, { assets?: Record<string, Asset> }> | undefined
    const today = localToday()
    const work = Object.entries(grants).flatMap(([pid, list]) => {
      const assets = portfolios?.[pid]?.assets
      if (!assets) return []
      const txs: RawTx[] = Object.values(assets).flatMap(a => a.transactions ?? [])
      return dueGrants(list, txs, today).filter(g => !tried.current.has(`${pid}:${g.id}`)).map(g => ({ pid, g, assets }))
    })
    if (!work.length) return

    busy.current = true
    void (async () => {
      let added = 0
      const failures: string[] = []
      const closesBy = new Map<string, Record<string, number>>()
      for (const { pid, g, assets } of work) {
        try {
          if (!closesBy.has(g.symbol)) closesBy.set(g.symbol, await loadCloses(g.symbol))
          const exec = vestingPrice(closesBy.get(g.symbol)!, g, today)
          if (!exec) continue // prezzo non ancora disponibile: si riprova alla prossima apertura
          const aid = assetFor(assets, g.isin, g.symbol, g.currency) ?? `premio_${g.symbol.replace(/[.$#[\]/\s]/g, '_')}`
          const newAsset: Asset = {
            nome: g.symbol, ticker: g.symbol, valuta: g.currency, tipoAsset: 'stock', commDefault: 0, transactions: [],
            ...(g.isin ? { isin: g.isin } : {}),
          }
          if (await edit.addBonus(pid, aid, buildBonusTx(g, exec, newId), assets[aid] ?? newAsset)) added += 1
          tried.current.add(`${pid}:${g.id}`)
        } catch (e) {
          tried.current.add(`${pid}:${g.id}`)
          failures.push(`${g.symbol} ${g.vestDate}: ${e instanceof Error ? e.message : 'errore'}`)
        }
      }
      busy.current = false
      if (failures.length) setMessage({ kind: 'error', text: `Azioni premio: ${failures.length} non registrate (${failures.slice(0, 2).join('; ')}). Riprova riaprendo l'app.` })
      else if (added) setMessage({ kind: 'ok', text: `Azioni premio maturate: ${added} ${added === 1 ? 'assegnazione registrata' : 'assegnazioni registrate'} al prezzo di chiusura del giorno (reddito da dichiarare nel quadro RM).` })
    })()
  }, [state, grants, edit])

  if (!message) return null
  return (
    <div className={`card ${message.kind === 'error' ? 'error' : ''}`} role={message.kind === 'error' ? 'alert' : 'status'}>
      {message.text} <button type="button" className="linklike" onClick={() => setMessage(null)}>Chiudi</button>
    </div>
  )
}
