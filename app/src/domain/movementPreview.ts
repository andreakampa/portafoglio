// Anteprima del movimento mentre lo si scrive (come ui/transactions.js del sito vecchio): nuova quantità e PMC,
// plus/minus, imposta con le minus compensate, incasso o spesa netta. Rifà il calcolo con il motore vero su una copia
// del portafoglio con il movimento aggiunto (o sostituito, se lo si sta modificando): stessi regimi e cambi dei numeri reali.
// Dice anche se il movimento vende o ricopre più di quanto c'è, anche per effetto su una vendita successiva.

import { computePortfolio, type PortfolioResult, type RawPortfolio } from './engine/portfolio.ts'
import type { FxLookup, RawAsset, RawTx } from './engine/types.ts'

export interface PreviewSnapshot {
  qty: number
  pmcNative: number
  pmcEur: number
}

export interface MovementPreview {
  before: PreviewSnapshot
  after: PreviewSnapshot
  grossNative: number
  grossEur: number
  commissionEur: number
  /** Plus/minus di questo movimento (vendite e chiusure short). */
  gainEur: number | null
  /** Imposta in più (o in meno) per l'anno del movimento. */
  taxEur: number
  /** Minus del cassetto usate da questo movimento. */
  lossesUsedEur: number
  /** Cassa: negativa se si spende, positiva se si incassa; al netto di commissioni e imposta. */
  cashEur: number
  /** Cambio del giorno non ancora noto: si è usato l'ultimo disponibile. */
  fxEstimated: boolean
  /** Il movimento chiude più di quanto c'è (o fa sforare una chiusura successiva). */
  overLimit: { date: string; available: number; own: boolean } | null
}

const PREVIEW_ID = 'preview#'
const snap = (p?: PortfolioResult['positions'][string]): PreviewSnapshot => ({ qty: p?.qty ?? 0, pmcNative: p?.pmcNative ?? 0, pmcEur: p?.pmcEur ?? 0 })
const overIssues = (r: PortfolioResult, aid: string) => (r.positions[aid]?.issues ?? []).filter(i => i.code === 'vendita-oltre-quantita')

export function previewMovement(input: {
  portfolio: RawPortfolio
  fx: FxLookup
  /** Unità di valuta per 1 EUR più recenti: per i giorni senza cambio ufficiale. */
  latestFx: Record<string, number>
  assetId: string
  tx: RawTx
  /** Posizione del movimento che si sta modificando. */
  replaceIndex?: number
  /** Titolo nuovo, non ancora nel portafoglio. */
  newAsset?: RawAsset
}): MovementPreview {
  const { portfolio, assetId, replaceIndex } = input
  const year = Number(input.tx.date.slice(0, 4))
  let estimated = false
  const fx: FxLookup = (cur, d) => {
    const r = input.fx(cur, d)
    if (r) return r
    const latest = input.latestFx[cur]
    if (latest) estimated = true
    return latest
  }
  const base = computePortfolio(portfolio, fx)

  const sim: RawPortfolio = structuredClone(portfolio)
  const assets = (sim.assets ??= {})
  const asset = (assets[assetId] ??= structuredClone(input.newAsset ?? {}))
  const txs = [...(asset.transactions ?? [])]
  const id = PREVIEW_ID + (input.tx.id ?? '')
  const tx: RawTx = { ...input.tx, id }
  if (replaceIndex !== undefined && txs[replaceIndex]) txs[replaceIndex] = tx
  else txs.push(tx)
  asset.transactions = txs
  estimated = false
  const after = computePortfolio(sim, fx)

  const taxOf = (r: PortfolioResult) => r.fiscal.lines.filter(l => l.year === year).reduce((s, l) => s + l.taxEur, 0)
  const usedOf = (r: PortfolioResult) => r.fiscal.lines.filter(l => l.year === year).reduce((s, l) => s + l.compensatedEur, 0)

  const currency = (asset.valuta || 'EUR').toUpperCase()
  const rate = currency === 'EUR' ? 1 : fx(currency, tx.date) ?? NaN
  const qty = Number(tx.qty) || 0
  const price = Number(tx.price) || 0
  const grossNative = qty * price
  const grossEur = grossNative / rate
  const commission = Number(tx.commission) || 0
  const commCur = (tx.commissionCurrency || 'EUR').toUpperCase()
  const commissionEur = commission ? (commCur === 'EUR' ? commission : commission / (fx(commCur, tx.date) ?? NaN)) : 0
  const ev = after.positions[assetId]?.realized.find(e => e.txId === id)
  const taxEur = taxOf(after) - taxOf(base)
  const sign = tx.type === 'sell' || tx.type === 'short_sell' ? 1 : -1

  // Sforamenti nuovi: sul movimento stesso o su una chiusura successiva che ora non ha più abbastanza titoli.
  const known = new Set(overIssues(base, assetId).map(i => i.txId))
  const fresh = overIssues(after, assetId).filter(i => i.txId === id || !known.has(i.txId))
  const own = fresh.find(i => i.txId === id) ?? fresh[0]
  const steps = after.positions[assetId]?.steps ?? []
  const at = own ? steps.findIndex(s => txs[s.index]?.id === own.txId) : -1
  const available = at > 0 ? Math.abs(steps[at - 1]!.qty) : 0

  return {
    before: snap(base.positions[assetId]),
    after: snap(after.positions[assetId]),
    grossNative,
    grossEur,
    commissionEur,
    gainEur: ev ? ev.gainEur : null,
    taxEur,
    lossesUsedEur: usedOf(after) - usedOf(base),
    cashEur: sign * grossEur - commissionEur - taxEur,
    fxEstimated: estimated,
    overLimit: own ? { date: own.date ?? tx.date, available, own: own.txId === id } : null,
  }
}
