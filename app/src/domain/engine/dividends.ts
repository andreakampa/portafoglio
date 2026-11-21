// Dividendi: dati veri (movimenti di cassa IBKR) oppure stima (importo per azione di Yahoo × quantità
// posseduta il giorno prima dello stacco). Regole in docs/regole-fiscali.md.
//
// - Dichiarativo: i dividendi vanno in dichiarazione al 26% sul LORDO; la ritenuta estera già pagata
//   NON si sottrae (scelta prudente, punto controverso).
// - Amministrato: la banca trattiene il 26% sull'importo già al netto della ritenuta estera.
// - Ritenuta estera stimata: 15% sui titoli in USD (con W-8BEN), 0 altrove (sconosciuta).

import { num } from './fx.ts'
import type { RawAsset, RawTx, TaxRegime } from './types.ts'

export const DIVIDEND_TAX_RATE = 0.26
export const US_WITHHOLDING_RATE = 0.15

export interface YahooDividend {
  exDate: string // YYYY-MM-DD
  amount: number // per azione, nella valuta del titolo
}

export interface DividendRow {
  key: string
  date: string
  year: number
  symbol: string
  /** ISIN del titolo, se il movimento di cassa lo riporta (IBKR). */
  isin?: string
  currency: string
  grossEur: number
  /** Ritenuta estera (positiva = pagata). */
  withholdingEur: number
  /** Imposta italiana già trattenuta (amministrato) o da versare in dichiarazione (dichiarativo). */
  taxEur: number
  netEur: number
  source: 'ibkr' | 'stima'
}

export interface DividendYear {
  year: number
  grossEur: number
  withholdingEur: number
  taxEur: number
  netEur: number
  rows: DividendRow[]
}

/** Quantità long posseduta alla chiusura del giorno prima di `exDate` (chi la possiede incassa il dividendo). */
export function qtyBefore(txs: RawTx[], exDate: string): number {
  let q = 0
  for (const t of [...txs].sort((a, b) => a.date.localeCompare(b.date))) {
    if (t.date >= exDate) break
    const n = num(t.qty)
    if (t.type === 'buy') q += n
    else if (t.type === 'sell') q -= n
    else if (t.type === 'transfer') q += t.sourcePortfolioId ? n : -n
  }
  return Math.max(0, q)
}

const taxFor = (regime: TaxRegime, grossEur: number, withholdingEur: number) =>
  regime === 'dichiarativo' ? grossEur * DIVIDEND_TAX_RATE : Math.max(0, grossEur - withholdingEur) * DIVIDEND_TAX_RATE

/** Stima dei dividendi di un titolo dai dati Yahoo. Salta le date senza cambio e quelle future. */
export function estimateDividends(
  assetId: string,
  asset: RawAsset,
  yahoo: YahooDividend[],
  regime: TaxRegime,
  fx: (currency: string, date: string) => number | undefined,
  today: string,
): DividendRow[] {
  const currency = (asset.valuta || 'EUR').toUpperCase()
  const symbol = (asset.ticker || asset.nome || assetId).trim()
  const rows: DividendRow[] = []
  for (const d of yahoo) {
    if (d.exDate > today) continue
    const qty = qtyBefore(asset.transactions ?? [], d.exDate)
    if (qty <= 0) continue
    const rate = currency === 'EUR' ? 1 : fx(currency, d.exDate)
    if (!rate || rate <= 0) continue
    const grossEur = (qty * d.amount) / rate
    const withholdingEur = currency === 'USD' ? grossEur * US_WITHHOLDING_RATE : 0
    const taxEur = taxFor(regime, grossEur, withholdingEur)
    rows.push({
      key: `${assetId}#${d.exDate}`, date: d.exDate, year: Number(d.exDate.slice(0, 4)), symbol, currency,
      grossEur, withholdingEur, taxEur,
      netEur: grossEur - withholdingEur - (regime === 'dichiarativo' ? 0 : taxEur),
      source: 'stima',
    })
  }
  return rows
}

export interface CashflowLike {
  id?: string
  date?: string
  kind?: string
  symbol?: string
  isin?: string
  currency?: string
  amount?: number | string
  exchangeRate?: number | string
}

/**
 * Dividendi veri dai movimenti di cassa: dividendo e pagamento sostitutivo (entrate) e ritenute (con segno)
 * dello stesso titolo e giorno si uniscono in una riga. Importi in EUR col cambio del movimento o storico.
 */
export function dividendsFromCashflows(
  flows: CashflowLike[],
  regime: TaxRegime,
  fx: (currency: string, date: string) => number | undefined,
): DividendRow[] {
  const byKey = new Map<string, DividendRow>()
  for (const f of flows) {
    if (!f?.date || !(f.kind === 'dividend' || f.kind === 'pil' || f.kind === 'withholding')) continue
    const currency = (f.currency || 'EUR').toUpperCase()
    const saved = num(f.exchangeRate)
    const rate = currency === 'EUR' ? 1 : saved > 0 ? saved : fx(currency, f.date)
    if (!rate || rate <= 0) continue
    const eur = num(f.amount) / rate
    const key = `${f.symbol ?? ''}#${f.date}#${currency}`
    const row = byKey.get(key) ?? {
      key, date: f.date, year: Number(f.date.slice(0, 4)), symbol: f.symbol ?? '', ...(f.isin ? { isin: f.isin } : {}), currency,
      grossEur: 0, withholdingEur: 0, taxEur: 0, netEur: 0, source: 'ibkr' as const,
    }
    if (!row.isin && f.isin) row.isin = f.isin
    if (f.kind === 'withholding') row.withholdingEur -= eur
    else row.grossEur += eur
    byKey.set(key, row)
  }
  return [...byKey.values()].map(r => {
    const taxEur = taxFor(regime, r.grossEur, r.withholdingEur)
    return { ...r, taxEur, netEur: r.grossEur - r.withholdingEur - (regime === 'dichiarativo' ? 0 : taxEur) }
  })
}

/** Raggruppa per anno (dal più recente), con le righe dal giorno più recente. */
export function summarizeDividends(rows: DividendRow[]): DividendYear[] {
  const years = new Map<number, DividendYear>()
  for (const r of rows) {
    const y = years.get(r.year) ?? { year: r.year, grossEur: 0, withholdingEur: 0, taxEur: 0, netEur: 0, rows: [] }
    y.grossEur += r.grossEur
    y.withholdingEur += r.withholdingEur
    y.taxEur += r.taxEur
    y.netEur += r.netEur
    y.rows.push(r)
    years.set(r.year, y)
  }
  return [...years.values()]
    .map(y => ({ ...y, rows: y.rows.sort((a, b) => b.date.localeCompare(a.date)) }))
    .sort((a, b) => b.year - a.year)
}
