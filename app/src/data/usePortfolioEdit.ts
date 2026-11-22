import { ref, runTransaction, update } from 'firebase/database'
import { useMemo } from 'react'
import { useUser } from '../auth/context'
import type { RawAsset, RawTx } from '../domain/engine/types'
import { isRecorded } from '../domain/pac'
import { addToList, buildTransferPair, findSameAsset, findTransfer, removeFromList, replaceInList, transferWrites, type PortfolioLike, type TransferForm, type TxRef } from '../domain/txEdit'
import { db } from '../lib/firebase'

type Asset = RawAsset & { isin?: string; commDefault?: number }

const STALE = 'Il movimento è cambiato nel frattempo (forse da un altro dispositivo): chiudi e riprova.'

// Firebase non accetta undefined e non salva gli array vuoti: si toglie il superfluo prima di scrivere.
const clean = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T

/**
 * Modifiche ai movimenti. Ogni scrittura rilegge i dati dal server e li cambia in un colpo solo (transazione):
 * così non si perde nulla se nel frattempo scrive anche la sincronizzazione IBKR o un altro dispositivo.
 */
export function usePortfolioEdit() {
  const { user } = useUser()
  return useMemo(() => {
    const root = `users/${user.uid}/portfolio_state/portfolios`
    const assetRef = (pid: string, aid: string) => ref(db, `${root}/${pid}/assets/${aid}`)

    async function change(pid: string, aid: string, fn: (a: Asset | null) => Asset | undefined) {
      const r = await runTransaction(assetRef(pid, aid), cur => fn(cur as Asset | null) ?? undefined)
      if (!r.committed) throw new Error(STALE)
    }

    return {
      /** Aggiunge un movimento; se il titolo non esiste lo crea con `newAsset`. */
      add: (pid: string, aid: string, tx: RawTx, newAsset?: Asset) =>
        change(pid, aid, cur => {
          const base = cur ?? newAsset
          if (!base) return undefined
          return clean({ ...base, transactions: addToList(base.transactions, tx) })
        }),

      /**
       * Aggiunge la rata di un piano PAC solo se non c'è già (stessa chiave o rata a mano vicina): due dispositivi
       * aperti insieme non la duplicano. Torna true se l'ha scritta.
       */
      addPacRate: async (pid: string, aid: string, tx: RawTx, planId: string, plannedDate: string) => {
        let wrote = false
        const r = await runTransaction(assetRef(pid, aid), cur => {
          const a = cur as Asset | null
          if (!a || isRecorded(a.transactions ?? [], planId, plannedDate)) return undefined
          wrote = true
          return clean({ ...a, transactions: addToList(a.transactions, tx) })
        })
        return r.committed && wrote
      },

      /**
       * Registra le azioni premio maturate solo se non ci sono già (stessa chiave); se il titolo non esiste lo crea.
       * Torna true se l'ha scritta.
       */
      addBonus: async (pid: string, aid: string, tx: RawTx, newAsset: Asset) => {
        let wrote = false
        const r = await runTransaction(assetRef(pid, aid), cur => {
          const a = (cur as Asset | null) ?? newAsset
          if ((a.transactions ?? []).some(t => t.bonusKey && t.bonusKey === tx.bonusKey)) return undefined
          wrote = true
          return clean({ ...a, transactions: addToList(a.transactions, tx) })
        })
        return r.committed && wrote
      },

      save: (pid: string, aid: string, at: TxRef, tx: RawTx) =>
        change(pid, aid, cur => {
          const list = cur ? replaceInList(cur.transactions ?? [], at, tx) : null
          return cur && list ? clean({ ...cur, transactions: list }) : undefined
        }),

      remove: (pid: string, aid: string, at: TxRef) =>
        change(pid, aid, cur => {
          const list = cur ? removeFromList(cur.transactions ?? [], at) : null
          return cur && list ? clean({ ...cur, transactions: list }) : undefined
        }),

      /**
       * Corregge (data e quantità) o elimina un trasferimento: uscita ed entrata cambiano insieme, in una sola scrittura.
       * `portfolios` = dati attuali di tutti i portafogli.
       */
      changeTransfer: async (portfolios: Record<string, PortfolioLike>, transferId: string, change: { remove: true } | { form: TransferForm }) => {
        const pair = findTransfer(portfolios, transferId)
        if (!pair.out && !pair.in) throw new Error(STALE)
        const writes = transferWrites(portfolios, pair, change)
        await update(ref(db, root), clean(writes))
      },

      /**
       * Trasferisce un titolo in un altro portafoglio: un'uscita e un'entrata collegate dallo stesso `transferId`.
       * `price` è il costo medio in valuta del titolo. Le due metà si scrivono insieme.
       */
      transfer: async (
        from: { pid: string; aid: string; asset: Asset },
        to: { pid: string; assets: Record<string, Asset> | undefined },
        f: TransferForm,
        price: number,
      ) => {
        const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
        const pair = buildTransferPair(f, price, from.pid, to.pid, newId)
        const destAid = findSameAsset(to.assets, from.asset) ?? from.aid
        const dest: Asset = to.assets?.[destAid] ?? {
          nome: from.asset.nome, ticker: from.asset.ticker || from.asset.nome, valuta: from.asset.valuta || 'EUR',
          tipoAsset: from.asset.tipoAsset || 'stock', ...(from.asset.isin ? { isin: from.asset.isin } : {}),
          commDefault: from.asset.commDefault ?? 0, transactions: [],
        }
        await update(ref(db, root), clean({
          [`${from.pid}/assets/${from.aid}/transactions`]: addToList(from.asset.transactions, pair.out),
          [`${to.pid}/assets/${destAid}`]: { ...dest, transactions: addToList(dest.transactions, pair.in) },
        }))
      },
    }
  }, [user.uid])
}
