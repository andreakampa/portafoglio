import { useCallback } from 'react'
import { KIND_LABEL, type Movement } from '../domain/engine/movements'
import { pacSkipsFor } from '../domain/pac'
import { findTransfer, type PortfolioLike } from '../domain/txEdit'
import { toast } from '../lib/toast'
import { usePacPlans, usePacSkip } from './usePacPlans'
import type { Computed } from './useComputedPortfolio'
import { usePortfolioEdit } from './usePortfolioEdit'
import { usePortfolioState } from './usePortfolioState'

const fmtDate = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('it-IT')

export const isEditableMovement = (m: Movement) => m.kind === 'buy' || m.kind === 'sell' || m.kind === 'short_sell' || m.kind === 'buy_to_cover'
export const isTransferMovement = (m: Movement) => m.kind === 'transfer_in' || m.kind === 'transfer_out'

/**
 * Eliminazione di un movimento con conferma (Movimenti e Storico del titolo).
 * Un trasferimento si elimina insieme all'altra metà. Torna un messaggio d'errore o null.
 */
export function useMovementRemove(c: Computed): (m: Movement) => Promise<string | null> {
  const edit = usePortfolioEdit()
  const skipPac = usePacSkip()
  const { plans } = usePacPlans()
  const state = usePortfolioState()
  const portfolios = (state.status === 'ready' ? state.data?.portfolios : undefined) as Record<string, PortfolioLike> | undefined
  return useCallback(
    async (m: Movement) => {
      if (c.status !== 'ready') return 'Dati non ancora pronti: riprova tra un attimo.'
      const t = c.portfolio.assets?.[m.assetId]?.transactions?.[m.index]
      if (isTransferMovement(m)) {
        if (!portfolios || !t?.transferId) return 'Trasferimento non trovato: ricarica la pagina e riprova.'
        const pair = findTransfer(portfolios, t.transferId)
        const name = (pid?: string) => c.options.find(o => o.id === pid)?.name ?? 'altro portafoglio'
        const both = pair.out && pair.in ? ` Si eliminano insieme l'uscita da ${name(pair.out.pid)} e l'entrata in ${name(pair.in.pid)}.` : ''
        if (!confirm(`Eliminare il trasferimento di ${m.symbol} del ${fmtDate(m.date)}?${both}`)) return null
        try {
          await edit.changeTransfer(portfolios, t.transferId, { remove: true })
          toast('Trasferimento eliminato')
          return null
        } catch (e) {
          return e instanceof Error ? e.message : 'Eliminazione non riuscita.'
        }
      }
      const pac = t ? pacSkipsFor(t, plans ?? [], c.selectedId, m.assetId) : []
      const warn = m.fromBroker
        ? ' (È un movimento importato da IBKR: la sincronizzazione potrebbe riportarlo.)'
        : pac.length
          ? ' È una rata del piano PAC: non verrà ricreata.'
          : ''
      if (!confirm(`Eliminare ${KIND_LABEL[m.kind].toLowerCase()} di ${m.symbol} del ${fmtDate(m.date)}?${warn}`)) return null
      try {
        // Prima si segna la rata come saltata, poi si elimina: così il PAC non la ricrea nel frattempo.
        for (const s of pac) await skipPac(s.planId, s.date)
        await edit.remove(c.selectedId, m.assetId, { id: m.txId, index: m.index, date: t?.date ?? m.date, type: String(t?.type ?? m.kind) })
        toast('Movimento eliminato')
        return null
      } catch (e) {
        return e instanceof Error ? e.message : 'Eliminazione non riuscita.'
      }
    },
    [c, edit, portfolios, skipPac, plans],
  )
}
