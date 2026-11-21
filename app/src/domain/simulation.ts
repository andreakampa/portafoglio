// Simulatore: cosa succede a PMC, plus/minus e tasse se faccio queste operazioni oggi.
// Non salva nulla: aggiunge operazioni ipotetiche a una copia del portafoglio e rifà il calcolo con il motore vero,
// così regime (costo medio / LIFO), cambi storici e cassetto delle minus sono gli stessi dei numeri reali.

import { computePortfolio, type PortfolioResult, type RawPortfolio } from './engine/portfolio.ts'
import type { FxLookup, Issue, RawTx } from './engine/types.ts'
import { symbolOf } from './engine/valuation.ts'
import type { EditableType } from './txEdit.ts'

export interface SimOp {
  id: string
  assetId: string
  type: EditableType
  qty: number
  /** Prezzo nella valuta del titolo. */
  price: number
  /** Commissioni in EUR. */
  commissionEur: number
}

export interface PositionSnapshot {
  qty: number
  pmcNative: number
  pmcEur: number
  costEur: number
}

export interface SimOpResult {
  op: SimOp
  symbol: string
  currency: string
  grossNative: number
  grossEur: number
  /** Plus/minus in EUR (vendite e chiusure short), prima delle tasse. */
  gainEur: number | null
}

export interface SimAssetResult {
  assetId: string
  symbol: string
  currency: string
  before: PositionSnapshot
  after: PositionSnapshot
}

export interface Simulation {
  ops: SimOpResult[]
  assets: SimAssetResult[]
  year: number
  /** Plus/minus realizzate dalle operazioni simulate. */
  gainEur: number
  /** Imposta in più (o in meno) per l'anno corrente rispetto a prima. */
  taxEur: number
  /** Minus del cassetto usate dalle operazioni simulate. */
  lossesUsedEur: number
  /** Minus ancora disponibili nell'anno, prima e dopo. */
  lossesBeforeEur: number
  lossesAfterEur: number
  /** Cassa: negativa se si spende (acquisti, ricoperture), positiva se si incassa; al netto di commissioni e tasse. */
  cashEur: number
  commissionsEur: number
  issues: Issue[]
}

const snap = (p?: PortfolioResult['positions'][string]): PositionSnapshot => ({
  qty: p?.qty ?? 0,
  pmcNative: p?.pmcNative ?? 0,
  pmcEur: p?.pmcEur ?? 0,
  costEur: p?.costEur ?? 0,
})

const SIM = 'sim#'

export function simulate(input: {
  portfolio: RawPortfolio
  fx: FxLookup
  /** Unità di valuta per 1 EUR oggi: serve solo per le operazioni simulate. */
  latestFx: Record<string, number>
  ops: SimOp[]
  today: string
}): Simulation {
  const { portfolio, ops, today } = input
  const year = Number(today.slice(0, 4))
  const base = computePortfolio(portfolio, input.fx)

  const sim: RawPortfolio = structuredClone(portfolio)
  const assets = (sim.assets ??= {})
  const valid = ops.filter(o => assets[o.assetId] && o.qty > 0 && o.price >= 0)
  for (const o of valid) {
    const a = assets[o.assetId]!
    const tx: RawTx = { id: SIM + o.id, date: today, type: o.type, qty: o.qty, price: o.price, commission: o.commissionEur, commissionCurrency: 'EUR' }
    a.transactions = [...(a.transactions ?? []), tx] // ultimo: oggi è dopo tutto il resto
  }
  // Per oggi il cambio storico non c'è ancora: si usa quello più recente.
  const fx: FxLookup = (cur, d) => (d === today ? input.latestFx[cur] ?? input.fx(cur, d) : input.fx(cur, d))
  const after = computePortfolio(sim, fx)

  const taxOf = (r: PortfolioResult) => r.fiscal.lines.filter(l => l.year === year).reduce((s, l) => s + l.taxEur, 0)
  const usedOf = (r: PortfolioResult) => r.fiscal.lines.filter(l => l.year === year).reduce((s, l) => s + l.compensatedEur, 0)
  const availOf = (r: PortfolioResult) =>
    r.fiscal.buckets.filter(b => b.category === 'strumenti' && b.year <= year && year <= b.expiresYear).reduce((s, b) => s + b.remainingEur, 0)

  const results: SimOpResult[] = valid.map(o => {
    const a = assets[o.assetId]!
    const currency = (a.valuta || 'EUR').toUpperCase()
    const rate = currency === 'EUR' ? 1 : fx(currency, today) ?? NaN
    const grossNative = o.qty * o.price
    const ev = after.positions[o.assetId]?.realized.find(e => e.txId === SIM + o.id)
    return { op: o, symbol: symbolOf(a, o.assetId), currency, grossNative, grossEur: grossNative / rate, gainEur: ev ? ev.gainEur : null }
  })

  const touched = [...new Set(valid.map(o => o.assetId))]
  const taxEur = taxOf(after) - taxOf(base)
  const commissionsEur = valid.reduce((s, o) => s + o.commissionEur, 0)
  const cash = results.reduce((s, r) => {
    const sign = r.op.type === 'sell' || r.op.type === 'short_sell' ? 1 : -1
    return s + sign * r.grossEur - r.op.commissionEur
  }, 0)

  return {
    ops: results,
    assets: touched.map(id => ({
      assetId: id,
      symbol: symbolOf(assets[id]!, id),
      currency: (assets[id]!.valuta || 'EUR').toUpperCase(),
      before: snap(base.positions[id]),
      after: snap(after.positions[id]),
    })),
    year,
    gainEur: results.reduce((s, r) => s + (r.gainEur ?? 0), 0),
    taxEur,
    lossesUsedEur: usedOf(after) - usedOf(base),
    lossesBeforeEur: availOf(base),
    lossesAfterEur: availOf(after),
    cashEur: cash - taxEur,
    commissionsEur,
    issues: after.issues.filter(i => i.txId?.startsWith(SIM)),
  }
}
