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

/**
 * Operazioni del carrello da salvare come movimenti veri, con la data indicata. Il prezzo è quello simulato
 * (spesso la quotazione del momento): resta "da confermare" finché non si inserisce quello eseguito.
 * Se il conto è IBKR, la sincronizzazione lo collega all'ordine vero (stessa data, tipo e quantità, prezzo entro l'1%)
 * e corregge prezzo e commissioni.
 */
export function opsToTxs(ops: SimOp[], date: string, newId: () => string): { assetId: string; tx: RawTx }[] {
  return ops.map(op => ({
    assetId: op.assetId,
    tx: {
      id: newId(),
      date,
      type: op.type,
      qty: op.qty,
      price: op.price,
      commission: op.commissionEur,
      commissionCurrency: 'EUR',
      source: 'simulatore',
      priceEstimated: true,
    },
  }))
}

// ── Bollo/IVAFE e dividendi dopo le operazioni simulate ───────────────────────

export interface SimExtras {
  /** 'bollo' in amministrato (banca italiana), 'ivafe' in dichiarativo (broker estero). */
  wealthKind: 'bollo' | 'ivafe'
  /** Variazione del valore dei titoli posseduti (solo long: gli short non sono un'attività). */
  valueDeltaEur: number
  /** Variazione dell'imposta su un anno intero e sulla parte che resta dell'anno in corso. */
  wealthYearDeltaEur: number
  wealthThisYearDeltaEur: number
  /** Dividendi degli ultimi 12 mesi × nuova quantità: lordo e netto delle tasse, su un anno. */
  dividendsGrossDeltaEur: number
  dividendsNetDeltaEur: number
  /** Titoli senza prezzo o cambio di oggi: esclusi dal calcolo. */
  missing: string[]
}

/** Dividendi per azione staccati negli ultimi 12 mesi (nella valuta del titolo). */
export function trailingDividend(divs: { exDate: string; amount: number }[], today: string): number {
  const from = new Date(Date.parse(today + 'T12:00:00Z') - 365 * 86400000).toISOString().slice(0, 10)
  return divs.filter(d => d.exDate > from && d.exDate <= today).reduce((s, d) => s + d.amount, 0)
}

const WEALTH_RATE = 0.002
const DIV_TAX = 0.26
const US_WITHHOLDING = 0.15

/**
 * Effetto delle operazioni simulate su bollo/IVAFE (2 per mille annuo sul valore) e sui dividendi attesi
 * (ultimi 12 mesi). Netto dei dividendi: amministrato 26% sul netto della ritenuta estera; dichiarativo 26% sul lordo,
 * senza credito per la ritenuta (15% sui titoli in USD), come nel resto dell'app.
 */
export function simulateExtras(input: {
  sim: Simulation
  regime: 'amministrato' | 'dichiarativo'
  /** Prezzo di oggi per titolo (valuta del titolo), null se non noto. */
  prices: Record<string, number | null | undefined>
  latestFx: Record<string, number>
  /** Dividendo per azione degli ultimi 12 mesi, per titolo. */
  dividendPerShare: Record<string, number | undefined>
  today: string
}): SimExtras {
  const { sim, regime, today } = input
  const missing: string[] = []
  let valueDelta = 0
  let grossDelta = 0
  let netDelta = 0
  for (const a of sim.assets) {
    const rate = a.currency === 'EUR' ? 1 : input.latestFx[a.currency]
    const price = input.prices[a.assetId]
    const longDelta = Math.max(0, a.after.qty) - Math.max(0, a.before.qty)
    if (!longDelta) continue
    if (!rate || !price) {
      missing.push(a.symbol)
      continue
    }
    valueDelta += (longDelta * price) / rate
    const dps = input.dividendPerShare[a.assetId] ?? 0
    const gross = (longDelta * dps) / rate
    const withholding = a.currency === 'USD' ? gross * US_WITHHOLDING : 0
    grossDelta += gross
    netDelta += regime === 'dichiarativo' ? gross - withholding - gross * DIV_TAX : (gross - withholding) * (1 - DIV_TAX)
  }
  const y = Number(today.slice(0, 4))
  const daysInYear = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 366 : 365
  const left = Math.round((Date.parse(`${y}-12-31T12:00:00Z`) - Date.parse(today + 'T12:00:00Z')) / 86400000) + 1
  const yearDelta = valueDelta * WEALTH_RATE
  return {
    wealthKind: regime === 'dichiarativo' ? 'ivafe' : 'bollo',
    valueDeltaEur: valueDelta,
    wealthYearDeltaEur: yearDelta,
    wealthThisYearDeltaEur: (yearDelta * left) / daysInYear,
    dividendsGrossDeltaEur: grossDelta,
    dividendsNetDeltaEur: netDelta,
    missing,
  }
}

/** Quantità intera comprabile con un budget in euro (commissioni comprese). */
export function qtyForBudget(budgetEur: number, priceNative: number, rate: number, commissionEur: number): number {
  const unitEur = priceNative / rate
  if (!(budgetEur > 0) || !(unitEur > 0)) return 0
  return Math.max(0, Math.floor((budgetEur - commissionEur) / unitEur))
}
