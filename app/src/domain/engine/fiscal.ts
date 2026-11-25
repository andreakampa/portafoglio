import type { RealizedDetail, RealizedEvent } from './positions.ts'
import type { AssetType, TaxRegime } from './types.ts'

/** Le minus si possono usare fino al 31/12 del quarto anno successivo a quello di realizzo. */
export const YEARS_CARRY_FORWARD = 4

export type Category = 'strumenti' | 'crypto'

/** Aliquota effettiva sul guadagno pieno (per mostrarla all'utente). */
export function taxRateFor(assetType: AssetType | undefined): number {
  if (assetType === 'bond') return 0.125
  if (assetType === 'crypto') return 0.33
  return 0.26
}

/**
 * Titoli di Stato e "white list": plus e minus entrano nel calcolo per il 48,08%,
 * poi tassati al 26% (= 12,5% effettivo). Così una minus su BTP compensa meno di una su azioni.
 */
export const BOND_WEIGHT = 0.4808
const baseWeight = (assetType: AssetType | undefined) => (assetType === 'bond' ? BOND_WEIGHT : 1)
const baseRate = (assetType: AssetType | undefined) => (assetType === 'crypto' ? 0.33 : 0.26)

export const categoryFor = (assetType: AssetType | undefined): Category => (assetType === 'crypto' ? 'crypto' : 'strumenti')

/**
 * Plus di fondi ed ETF sono redditi di capitale: non si compensano con le minus.
 * Le loro minus invece sono redditi diversi e alimentano il cassetto come le altre.
 */
export const plusNotCompensable = (assetType: AssetType | undefined) => assetType === 'fondo' || assetType === 'etf'

export interface FiscalEventInput extends RealizedEvent {
  assetId: string
  assetName: string
  assetType: AssetType
}

export interface ManualLoss {
  amount: number | string
  date: string
  title?: string
  categoria?: Category
}

/** Quanto di una minus è andato a compensare una plus (o viceversa): `key` è la riga dall'altra parte. */
export interface LossUse {
  key: string
  eur: number
}

export interface FiscalLine {
  key: string
  /** Per le minus inserite a mano: posizione nell'elenco `fiscal.manualLosses` (serve per modificarle). */
  manualIndex?: number
  assetId: string | null
  assetName: string
  assetType: AssetType
  date: string
  year: number
  side: 'long' | 'short' | 'manuale'
  /** Quantità chiusa e come si arriva al risultato (assenti per le minus inserite a mano). */
  qty?: number
  proceedsEur?: number
  costEur?: number
  detail?: RealizedDetail
  gainEur: number
  /** Minus usate per compensare questa plus (per i titoli di Stato: sulla base al 48,08%). */
  compensatedEur: number
  /** Imponibile al 26% (33% per crypto) dopo la compensazione. */
  taxableEur: number
  taxEur: number
  excluded: 'fondo-etf' | null
  /** Plus: da quali minus viene `compensatedEur`. */
  usedFrom?: LossUse[]
  /** Minus: su quali plus è stata usata (per i titoli di Stato sulla base al 48,08%). */
  usedBy?: LossUse[]
  /** Minus: quanto ne resta da usare (anche se scaduta: la scadenza è `year` + 4). */
  lossLeftEur?: number
}

export interface LossBucket {
  category: Category
  year: number
  /** Ultimo anno in cui la minus si può ancora usare. */
  expiresYear: number
  originalEur: number
  remainingEur: number
}

export interface FiscalResult {
  lines: FiscalLine[]
  /** Minus ancora disponibili (cassetto), per anno e categoria. */
  buckets: LossBucket[]
}

const yearOf = (date: string) => Number(date.slice(0, 4))

/**
 * Cassetto fiscale in ordine cronologico: ogni minus entra nel cassetto della sua categoria,
 * ogni plus consuma prima le minus più vecchie ancora valide.
 */
export function computeFiscal(
  events: FiscalEventInput[],
  manualLosses: ManualLoss[] = [],
  regime: TaxRegime = 'amministrato',
): FiscalResult {
  type Item = { kind: 'event'; e: FiscalEventInput; key: string } | { kind: 'manual'; m: ManualLoss; key: string; index: number }
  const items: Item[] = [
    ...events.map((e, i) => ({ kind: 'event' as const, e, key: `${e.assetId}#${e.txId ?? e.date}#${i}` })),
    ...manualLosses.map((m, i) => ({ kind: 'manual' as const, m, key: `manual#${i}#${m.date}`, index: i })),
  ]
  const dateOf = (it: (typeof items)[number]) => (it.kind === 'event' ? it.e.date : it.m.date)
  const isLoss = (it: (typeof items)[number]) => it.kind === 'manual' || it.e.gainEur < 0
  items.sort((a, b) => {
    // Dichiarativo: nella dichiarazione (quadro RT) plus e minus dello stesso anno si sommano
    // tutte, quindi le minus dell'anno compensano anche le plus realizzate prima di loro.
    if (regime === 'dichiarativo') {
      const ya = dateOf(a).slice(0, 4)
      const yb = dateOf(b).slice(0, 4)
      if (ya !== yb) return ya.localeCompare(yb)
      if (isLoss(a) !== isLoss(b)) return isLoss(a) ? -1 : 1
    }
    // Amministrato: conta l'ordine cronologico. A parità di data prima le minus manuali.
    return dateOf(a).localeCompare(dateOf(b)) || (a.kind === b.kind ? 0 : a.kind === 'manual' ? -1 : 1)
  })

  const buckets: LossBucket[] = []
  const lines: FiscalLine[] = []
  // Dentro ogni cassetto (anno e categoria) le singole minus, nell'ordine in cui sono nate:
  // si usano prima le più vecchie. Serve solo a dire quale minus è finita su quale plus.
  const sources = new Map<LossBucket, { line: FiscalLine; remaining: number }[]>()

  const addLoss = (category: Category, year: number, amount: number, line: FiscalLine) => {
    if (amount <= 0.005) return
    let b = buckets.find(x => x.category === category && x.year === year)
    if (!b) {
      b = { category, year, expiresYear: year + YEARS_CARRY_FORWARD, originalEur: 0, remainingEur: 0 }
      buckets.push(b)
      sources.set(b, [])
    }
    b.originalEur += amount
    b.remainingEur += amount
    sources.get(b)!.push({ line, remaining: amount })
  }

  const consumeLosses = (category: Category, year: number, wanted: number, gainKey: string) => {
    let used = 0
    const from: LossUse[] = []
    const usable = buckets
      .filter(b => b.category === category && b.remainingEur > 0.005 && b.year <= year && year <= b.expiresYear)
      .sort((a, b) => a.year - b.year)
    for (const b of usable) {
      for (const src of sources.get(b)!) {
        const u = Math.min(src.remaining, wanted - used)
        if (u <= 0.005) continue
        src.remaining -= u
        b.remainingEur -= u
        used += u
        from.push({ key: src.line.key, eur: u })
        ;(src.line.usedBy ??= []).push({ key: gainKey, eur: u })
        if (wanted - used <= 0.005) break
      }
      if (wanted - used <= 0.005) break
    }
    return { used, from }
  }

  for (const it of items) {
    if (it.kind === 'manual') {
      const amount = Math.abs(parseFloat(String(it.m.amount)) || 0)
      if (amount <= 0.005 || !it.m.date) continue
      const category = it.m.categoria === 'crypto' ? 'crypto' : 'strumenti'
      const line: FiscalLine = {
        key: it.key, manualIndex: it.index, assetId: null, assetName: it.m.title || 'Minus inserita a mano', assetType: 'altro',
        date: it.m.date, year: yearOf(it.m.date), side: 'manuale', gainEur: -amount,
        compensatedEur: 0, taxableEur: 0, taxEur: 0, excluded: null,
      }
      lines.push(line)
      addLoss(category, yearOf(it.m.date), amount, line)
      continue
    }

    const e = it.e
    const year = yearOf(e.date)
    const category = categoryFor(e.assetType)
    const base = {
      key: it.key, assetId: e.assetId, assetName: e.assetName, assetType: e.assetType, date: e.date, year, side: e.side,
      qty: e.qty, proceedsEur: e.proceedsEur, costEur: e.costEur, detail: e.detail,
    }

    if (e.gainEur < -0.005) {
      const line: FiscalLine = { ...base, gainEur: e.gainEur, compensatedEur: 0, taxableEur: 0, taxEur: 0, excluded: null }
      lines.push(line)
      addLoss(category, year, -e.gainEur * baseWeight(e.assetType), line)
      continue
    }
    if (e.gainEur <= 0.005) {
      lines.push({ ...base, gainEur: e.gainEur, compensatedEur: 0, taxableEur: 0, taxEur: 0, excluded: null })
      continue
    }

    const excluded = plusNotCompensable(e.assetType) ? ('fondo-etf' as const) : null
    const taxBase = e.gainEur * baseWeight(e.assetType)
    const { used: compensatedEur, from } = excluded ? { used: 0, from: [] } : consumeLosses(category, year, taxBase, it.key)
    const taxableEur = taxBase - compensatedEur
    lines.push({
      ...base, gainEur: e.gainEur, compensatedEur, taxableEur,
      taxEur: taxableEur * baseRate(e.assetType), excluded,
      ...(from.length ? { usedFrom: from } : {}),
    })
  }

  for (const list of sources.values()) for (const src of list) src.line.lossLeftEur = Math.max(0, src.remaining)

  return { lines, buckets: buckets.sort((a, b) => a.category.localeCompare(b.category) || a.year - b.year) }
}

/** Minus ancora utilizzabili in un dato anno, per categoria. */
export function availableLosses(result: FiscalResult, year: number, category: Category = 'strumenti'): number {
  return result.buckets
    .filter(b => b.category === category && b.year <= year && year <= b.expiresYear)
    .reduce((s, b) => s + b.remainingEur, 0)
}
