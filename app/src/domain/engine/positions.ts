import { amounts, num } from './fx.ts'
import type { CostMethod, FxLookup, Issue, RawAsset, RawTx } from './types.ts'

const EPS = 1e-6

/** Lotto aperto: una quantità con il suo costo, in valuta del titolo e in EUR. */
interface Lot {
  id: string // `${data}#${n}`: lo stesso formato usato da lotAllocation nel sito attuale
  date: string
  qty: number
  costNative: number // costo residuo totale (prezzo + quota commissioni)
  costEur: number
}

/** Risultato realizzato da una singola chiusura (vendita o ricopertura short). */
export interface RealizedEvent {
  txId?: string
  date: string
  side: 'long' | 'short'
  qty: number
  proceedsEur: number // incasso netto commissioni
  costEur: number // costo fiscale dei lotti chiusi
  gainEur: number // plus (>0) o minus (<0)
  gainNative: number
}

export interface PositionResult {
  /** Quantità aperta: positiva se long, negativa se short. */
  qty: number
  /** Costo dei lotti aperti (per lo short: incasso netto ancora "in sospeso"). */
  costNative: number
  costEur: number
  /** Prezzo medio di carico per unità, commissioni incluse. */
  pmcNative: number
  pmcEur: number
  isShort: boolean
  realized: RealizedEvent[]
  realizedEur: number
  commissionsEur: number
  issues: Issue[]
}

/** Parte di costo che accompagna un titolo trasferito: data e costo dell'acquisto originale. */
export interface TransferPiece {
  date: string
  qty: number
  costNative: number
  costEur: number
}

/** Collegamenti con gli altri portafogli, forniti da `computeAllPortfolios`. */
export interface TransferHooks {
  /** Costo con cui arriva un titolo in entrata (da uscita collegata dal `transferId`); undefined = non noto. */
  incoming?: (tx: RawTx, currency: string) => TransferPiece[] | undefined
  /** Registra quali lotti sono usciti con un trasferimento in uscita. */
  outgoing?: (tx: RawTx, pieces: TransferPiece[]) => void
  /** Registra il premio di un'opzione esercitata o assegnata (movimento `exercise`). */
  exercised?: (tx: RawTx, premium: OptionPremium) => void
  /** Premio dell'opzione collegata (stesso `exerciseId`) a un acquisto o vendita del sottostante. */
  premium?: (tx: RawTx) => OptionPremium | undefined
}

/**
 * Premio dei contratti chiusi per esercizio o assegnazione. long = opzione comprata (premio pagato),
 * short = opzione venduta (premio incassato). Regola fiscale (circ. 165/E 1998): il premio entra nel costo
 * del titolo comprato o nel corrispettivo di quello venduto, non è un risultato a sé.
 */
export interface OptionPremium {
  side: 'long' | 'short'
  currency: string
  costNative: number
  costEur: number
}

const byDate = (a: RawTx, b: RawTx) => a.date.localeCompare(b.date)

/** Consuma `qty` dai lotti secondo il metodo; restituisce il costo consumato. */
function consume(
  lots: Lot[],
  qty: number,
  method: CostMethod,
  tx: RawTx,
  issues: Issue[],
): { costNative: number; costEur: number; consumed: number; pieces: TransferPiece[] } {
  let costNative = 0
  let costEur = 0
  let left = qty
  const pieces: TransferPiece[] = []

  const take = (lot: Lot, q: number) => {
    const share = q / lot.qty
    pieces.push({ date: lot.date, qty: q, costNative: lot.costNative * share, costEur: lot.costEur * share })
    costNative += lot.costNative * share
    costEur += lot.costEur * share
    lot.costNative -= lot.costNative * share
    lot.costEur -= lot.costEur * share
    lot.qty -= q
    left -= q
  }

  // 1. Lotti scelti esplicitamente sul movimento (vendita "a lotti specifici").
  for (const alloc of tx.lotAllocation ?? []) {
    const lot = lots.find(l => l.id === alloc.lotId)
    if (!lot) {
      issues.push({ txId: tx.id, date: tx.date, code: 'lotto-inesistente', message: `Lotto ${alloc.lotId} non trovato` })
      continue
    }
    const q = Math.min(lot.qty, num(alloc.qty), left)
    if (q > 0) take(lot, q)
  }

  // 2. Il resto secondo il metodo del regime.
  if (left > EPS) {
    if (method === 'lifo') {
      for (let i = lots.length - 1; i >= 0 && left > EPS; i--) {
        const lot = lots[i]!
        if (lot.qty > EPS) take(lot, Math.min(lot.qty, left))
      }
    } else if (method === 'fifo') {
      for (const lot of lots) {
        if (left <= EPS) break
        if (lot.qty > EPS) take(lot, Math.min(lot.qty, left))
      }
    } else {
      // Costo medio ponderato = consumo proporzionale da tutti i lotti aperti.
      const open = lots.reduce((s, l) => s + l.qty, 0)
      if (open > EPS) {
        const q = Math.min(left, open)
        for (const lot of lots) if (lot.qty > EPS) take(lot, (lot.qty / open) * q)
      }
    }
  }

  const consumed = qty - left
  if (left > EPS) {
    issues.push({
      txId: tx.id,
      date: tx.date,
      code: 'vendita-oltre-quantita',
      message: `Chiusura di ${qty} con solo ${consumed.toFixed(6)} disponibili`,
    })
  }
  for (let i = lots.length - 1; i >= 0; i--) if (lots[i]!.qty <= EPS) lots.splice(i, 1)
  return { costNative, costEur, consumed, pieces }
}

function lotIdFactory() {
  const counters: Record<string, number> = {}
  return (date: string) => {
    const n = counters[date] ?? 0
    counters[date] = n + 1
    return `${date}#${n}`
  }
}

/**
 * Calcola la posizione di un titolo e tutti i risultati realizzati.
 * Long e short sono indipendenti: lo short ha i suoi lotti (incasso della vendita allo scoperto)
 * che si chiudono con buy_to_cover; il risultato è incasso − costo di riacquisto.
 */
export function computePosition(asset: RawAsset, method: CostMethod, fx: FxLookup, hooks: TransferHooks = {}): PositionResult {
  const currency = (asset.valuta || 'EUR').toUpperCase()
  const issues: Issue[] = []
  const longLots: Lot[] = []
  const shortLots: Lot[] = []
  const realized: RealizedEvent[] = []
  const longId = lotIdFactory()
  const shortId = lotIdFactory()
  let commissionsEur = 0

  const txs = [...(asset.transactions ?? [])].filter(t => t && t.date).sort(byDate)

  for (const tx of txs) {
    const a = amounts(tx, currency, fx, issues)
    if (!(a.qty > 0)) {
      issues.push({ txId: tx.id, date: tx.date, code: 'quantita-non-valida', message: `Quantità non valida: ${tx.qty}` })
      continue
    }
    commissionsEur += a.commissionEur

    // Titolo comprato o venduto per esercizio/assegnazione di un'opzione: il premio cambia costo o ricavo.
    if (tx.exerciseId && tx.type !== 'exercise') {
      const p = hooks.premium?.(tx)
      if (p) {
        const native = p.currency === currency ? p.costNative : p.costEur * a.rate
        // Premio pagato: alza il costo di chi compra e abbassa il ricavo di chi vende; premio incassato: il contrario.
        const buySide = tx.type === 'buy' || tx.type === 'buy_to_cover'
        const sign = (p.side === 'long' ? 1 : -1) * (buySide ? 1 : -1)
        a.grossNative += sign * native
        a.grossEur += sign * p.costEur
      }
    }

    switch (tx.type) {
      case 'exercise': {
        // Chiude i contratti (lunghi o venduti) senza plus o minus: il loro costo passa al sottostante.
        const side = longLots.reduce((s, l) => s + l.qty, 0) > EPS ? 'long' : 'short'
        const c = consume(side === 'long' ? longLots : shortLots, a.qty, method, tx, issues)
        if (tx.exerciseId) hooks.exercised?.(tx, { side, currency, costNative: c.costNative, costEur: c.costEur })
        break
      }

      case 'buy':
        longLots.push({
          id: longId(tx.date),
          date: tx.date,
          qty: a.qty,
          costNative: a.grossNative + a.commissionNative,
          costEur: a.grossEur + a.commissionEur,
        })
        break

      case 'transfer':
        if (tx.sourcePortfolioId) {
          // In entrata: porta con sé i lotti usciti dal portafoglio di origine, col loro costo e la loro data
          // di acquisto (il cambio storico resta quello degli acquisti, non quello del giorno del trasferimento).
          const pieces = tx.transferId ? hooks.incoming?.(tx, currency) : undefined
          const total = pieces?.reduce((s, p) => s + p.qty, 0) ?? 0
          if (pieces && Math.abs(total - a.qty) <= EPS) {
            for (const p of pieces) longLots.push({ id: longId(p.date), date: p.date, qty: p.qty, costNative: p.costNative, costEur: p.costEur })
            // LIFO per data di acquisto: i lotti arrivati vanno al loro posto, non in fondo.
            longLots.sort((x, y) => x.date.localeCompare(y.date))
          } else {
            // Senza uscita collegata: prezzo di carico indicato sul movimento, al cambio della data del trasferimento.
            if (tx.transferId) issues.push({ txId: tx.id, date: tx.date, code: 'trasferimento-non-collegato', message: 'Entrata senza uscita corrispondente (o quantità diversa): costo al cambio del giorno' })
            longLots.push({ id: longId(tx.date), date: tx.date, qty: a.qty, costNative: a.grossNative, costEur: a.grossEur })
          }
        } else {
          // In uscita: esce al costo, nessun risultato realizzato.
          const c = consume(longLots, a.qty, method, tx, issues)
          if (tx.transferId) hooks.outgoing?.(tx, c.pieces)
        }
        break

      case 'sell': {
        const c = consume(longLots, a.qty, method, tx, issues)
        const proceedsNative = (a.grossNative - a.commissionNative) * (c.consumed / a.qty)
        const proceedsEur = (a.grossEur - a.commissionEur) * (c.consumed / a.qty)
        realized.push({
          txId: tx.id,
          date: tx.date,
          side: 'long',
          qty: c.consumed,
          proceedsEur,
          costEur: c.costEur,
          gainEur: proceedsEur - c.costEur,
          gainNative: proceedsNative - c.costNative,
        })
        break
      }

      case 'short_sell':
        // Il "costo" del lotto short è l'incasso netto della vendita allo scoperto.
        shortLots.push({
          id: shortId(tx.date),
          date: tx.date,
          qty: a.qty,
          costNative: a.grossNative - a.commissionNative,
          costEur: a.grossEur - a.commissionEur,
        })
        break

      case 'buy_to_cover': {
        const c = consume(shortLots, a.qty, method, tx, issues)
        const share = c.consumed / a.qty
        const coverEur = (a.grossEur + a.commissionEur) * share
        const coverNative = (a.grossNative + a.commissionNative) * share
        realized.push({
          txId: tx.id,
          date: tx.date,
          side: 'short',
          qty: c.consumed,
          proceedsEur: c.costEur,
          costEur: coverEur,
          gainEur: c.costEur - coverEur,
          gainNative: c.costNative - coverNative,
        })
        break
      }
    }
  }

  const longQty = longLots.reduce((s, l) => s + l.qty, 0)
  const shortQty = shortLots.reduce((s, l) => s + l.qty, 0)
  const isShort = shortQty > EPS && longQty <= EPS
  const lots = isShort ? shortLots : longLots
  const qtyAbs = isShort ? shortQty : longQty
  const costNative = lots.reduce((s, l) => s + l.costNative, 0)
  const costEur = lots.reduce((s, l) => s + l.costEur, 0)

  return {
    qty: isShort ? -shortQty : longQty > EPS ? longQty : 0,
    costNative: qtyAbs > EPS ? costNative : 0,
    costEur: qtyAbs > EPS ? costEur : 0,
    pmcNative: qtyAbs > EPS ? costNative / qtyAbs : 0,
    pmcEur: qtyAbs > EPS ? costEur / qtyAbs : 0,
    isShort,
    realized,
    realizedEur: realized.reduce((s, e) => s + e.gainEur, 0),
    commissionsEur,
    issues,
  }
}

export const methodFor = (regime: string | undefined): CostMethod => (regime === 'dichiarativo' ? 'lifo' : 'average')
