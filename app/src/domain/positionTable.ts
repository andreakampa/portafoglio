// Tabella Posizioni come nel sito vecchio (COLUMN_DEFS e groupedSortedIds in js/modules/portfolio/render.js):
// colonne configurabili, ordinamento per colonna, gruppi. Funzioni pure, i numeri vengono dal motore nuovo.
import { taxRateFor, type FiscalLine } from './engine/fiscal.ts'
import type { PositionResult } from './engine/positions.ts'
import type { RawAsset } from './engine/types.ts'
import type { PositionRow } from './engine/valuation.ts'

export type ColumnId =
  | 'qty' | 'pmc' | 'price' | 'prevClose' | 'day' | 'cost' | 'value' | 'weightCost' | 'weightValue'
  | 'unrealized' | 'unrealizedNet' | 'realized' | 'realizedNet' | 'pmcEur' | 'commissions'

export interface ColumnDef {
  id: ColumnId
  label: string
  /** Colonne nuove o di dettaglio: nascoste finché non si attivano dall'ingranaggio. */
  defaultHidden?: boolean
}

/** Colonne tra "Titolo" (sempre prima) e le azioni (sempre ultime), nell'ordine di partenza. */
export const COLUMNS: ColumnDef[] = [
  { id: 'qty', label: 'Quantità', defaultHidden: true },
  { id: 'pmc', label: 'PMC' },
  { id: 'price', label: 'Prezzo' },
  { id: 'prevClose', label: 'Chiusura ieri', defaultHidden: true },
  { id: 'day', label: 'Oggi' },
  { id: 'cost', label: 'Costo', defaultHidden: true },
  { id: 'value', label: 'Valore' },
  { id: 'weightCost', label: '% costo', defaultHidden: true },
  { id: 'weightValue', label: 'Peso' },
  { id: 'unrealized', label: 'Risultato' },
  { id: 'unrealizedNet', label: 'Risultato netto', defaultHidden: true },
  { id: 'realized', label: 'Realizzato', defaultHidden: true },
  { id: 'realizedNet', label: 'Realizzato netto', defaultHidden: true },
  { id: 'pmcEur', label: 'PMC in €', defaultHidden: true },
  { id: 'commissions', label: 'Commissioni', defaultHidden: true },
]
const IDS = COLUMNS.map(c => c.id)

export interface ColumnConfig {
  order: ColumnId[]
  hidden: ColumnId[]
}

/**
 * Configurazione salvata → completa: colonne sconosciute tolte, colonne nuove aggiunte in fondo
 * (nascoste se `defaultHidden`), così un aggiornamento dell'app non fa comparire colonne a sorpresa.
 */
export function reconcileColumns(saved: Partial<ColumnConfig> | null | undefined): ColumnConfig {
  const order = (Array.isArray(saved?.order) ? saved.order : []).filter((id, i, a): id is ColumnId => IDS.includes(id as ColumnId) && a.indexOf(id) === i)
  const hidden = new Set((Array.isArray(saved?.hidden) ? saved.hidden : []).filter(id => IDS.includes(id as ColumnId)))
  for (const c of COLUMNS) {
    if (order.includes(c.id)) continue
    order.push(c.id)
    if (c.defaultHidden) hidden.add(c.id)
  }
  return { order, hidden: [...hidden] }
}

export const visibleColumns = (cfg: ColumnConfig): ColumnId[] => cfg.order.filter(id => !cfg.hidden.includes(id))

/** Sposta una colonna di una posizione (−1 = a sinistra, +1 = a destra). */
export function moveColumn(cfg: ColumnConfig, id: ColumnId, delta: -1 | 1): ColumnConfig {
  const order = [...cfg.order]
  const i = order.indexOf(id)
  const j = i + delta
  if (i < 0 || j < 0 || j >= order.length) return cfg
  ;[order[i], order[j]] = [order[j]!, order[i]!]
  return { ...cfg, order }
}

export function toggleColumn(cfg: ColumnConfig, id: ColumnId): ColumnConfig {
  const hidden = cfg.hidden.includes(id) ? cfg.hidden.filter(h => h !== id) : [...cfg.hidden, id]
  return { ...cfg, hidden }
}

// ── Numeri di una riga ─────────────────────────────

export interface RowFigures {
  /** Variazione di oggi in euro (positiva = guadagno anche per gli short). */
  dayEur: number | null
  /** Parte del risultato dovuta al cambio: risultato fiscale (cambi storici) meno risultato al cambio di oggi. */
  fxEffectEur: number | null
  /** Imposta se si vendesse oggi solo questo titolo (sul guadagno fiscale, aliquota del tipo), e risultato netto. */
  taxEur: number | null
  unrealizedNetEur: number | null
  /** Realizzato del titolo al netto dell'imposta calcolata dal cassetto. */
  realizedNetEur: number
  commissionsEur: number
  pmcEur: number
  prevClose: number | null
}

export function rowFigures(
  r: PositionRow,
  asset: RawAsset | undefined,
  pos: PositionResult | undefined,
  lines: FiscalLine[],
  prevClose: number | null,
): RowFigures {
  let dayEur: number | null = null
  if (r.valueEur !== null && r.dayChangePct !== null && r.qty !== 0) {
    const size = Math.abs(r.valueEur)
    const yesterday = size / (1 + (r.isShort ? -r.dayChangePct : r.dayChangePct) / 100)
    dayEur = r.isShort ? yesterday - size : size - yesterday
  }
  let fxEffectEur: number | null = null
  if (r.currency !== 'EUR' && r.valueEur !== null && r.unrealizedEur !== null && r.costTodayFxEur !== null && r.qty !== 0) {
    const market = Math.abs(r.valueEur)
    const todayFxGain = r.isShort ? r.costTodayFxEur - market : market - r.costTodayFxEur
    fxEffectEur = r.unrealizedEur - todayFxGain
  }
  const taxEur = r.unrealizedEur === null ? null : Math.max(0, r.unrealizedEur) * taxRateFor(asset?.tipoAsset)
  const ownTax = lines.filter(l => l.assetId === r.assetId).reduce((s, l) => s + l.taxEur, 0)
  return {
    dayEur,
    fxEffectEur,
    taxEur,
    unrealizedNetEur: r.unrealizedEur === null || taxEur === null ? null : r.unrealizedEur - taxEur,
    realizedNetEur: r.realizedEur - ownTax,
    commissionsEur: pos?.commissionsEur ?? 0,
    pmcEur: pos?.pmcEur ?? 0,
    prevClose,
  }
}

// ── Gruppi ─────────────────────────────────────────

export type GroupId = 'active' | 'short' | 'closed' | 'empty' | 'transferred'
export const GROUP_LABEL: Record<GroupId, string> = {
  active: 'Titoli attivi',
  short: 'Short',
  closed: 'Chiuse',
  empty: 'Vuote',
  transferred: 'Trasferiti',
}
/** Aperti di partenza: attivi e short. Gli altri si aprono a richiesta. */
export const GROUPS_OPEN_BY_DEFAULT: GroupId[] = ['active', 'short']

const EPS = 1e-5
const transferredOut = (a: RawAsset | undefined) =>
  (a?.transactions ?? []).filter(t => t.type === 'transfer' && !(t as { sourcePortfolioId?: string }).sourcePortfolioId).reduce((s, t) => s + (Number(t.qty) || 0), 0)

/** Come il vecchio `groupedSortedIds`: un titolo trasferito in parte compare sia negli attivi sia nei trasferiti. */
export function groupRows(rows: PositionRow[], assets: Record<string, RawAsset>): Record<GroupId, PositionRow[]> {
  const g: Record<GroupId, PositionRow[]> = { active: [], short: [], closed: [], empty: [], transferred: [] }
  for (const r of rows) {
    const a = assets[r.assetId]
    const out = transferredOut(a)
    if (!(a?.transactions ?? []).length) g.empty.push(r)
    else if (out > 0 && Math.abs(r.qty) < EPS) g.transferred.push(r)
    else if (out > 0 && r.qty >= EPS) {
      g.active.push(r)
      g.transferred.push(r)
    } else if (r.qty <= -EPS) g.short.push(r)
    else if (Math.abs(r.qty) < EPS) g.closed.push(r)
    else g.active.push(r)
  }
  return g
}

// ── Ordinamento ────────────────────────────────────

export type SortKey = 'name' | ColumnId
export interface SortState {
  key: SortKey
  dir: 'asc' | 'desc'
}

export function sortValue(r: PositionRow, f: RowFigures, key: SortKey, weightBaseEur: number): number | string | null {
  switch (key) {
    case 'name': return r.symbol
    case 'qty': return Math.abs(r.qty)
    case 'pmc': return r.pmcNative
    case 'price': return r.price
    case 'prevClose': return f.prevClose
    case 'day': return r.dayChangePct
    case 'cost': return r.costEur
    case 'value': return r.valueEur === null ? null : Math.abs(r.valueEur)
    case 'weightCost': return weightBaseEur > 0 ? r.costEur / weightBaseEur : null
    case 'weightValue': return r.valueEur === null ? null : Math.abs(r.valueEur)
    case 'unrealized': return r.unrealizedEur
    case 'unrealizedNet': return f.unrealizedNetEur
    case 'realized': return r.realizedEur
    case 'realizedNet': return f.realizedNetEur
    case 'pmcEur': return f.pmcEur
    case 'commissions': return f.commissionsEur
  }
}

/** Ordina; i valori mancanti vanno sempre in fondo. Testi con l'ordine alfabetico italiano. */
export function sortRows<T extends { r: PositionRow; f: RowFigures }>(items: T[], s: SortState, weightBaseEur = 0): T[] {
  const sign = s.dir === 'asc' ? 1 : -1
  return [...items].sort((a, b) => {
    const va = sortValue(a.r, a.f, s.key, weightBaseEur)
    const vb = sortValue(b.r, b.f, s.key, weightBaseEur)
    if (va === null && vb === null) return 0
    if (va === null) return 1
    if (vb === null) return -1
    if (typeof va === 'string' || typeof vb === 'string') return sign * String(va).localeCompare(String(vb), 'it', { sensitivity: 'base' })
    return sign * (va - vb)
  })
}
