// Prospetto per la dichiarazione dei redditi (Redditi PF; nel 730 i quadri T, M e W) per i conti in
// regime dichiarativo (broker estero, es. IBKR). Funzioni pure, senza rete.
// Righi e colonne secondo le istruzioni Redditi PF 2026 (anno d'imposta 2025): vedi docs/regole-fiscali.md.
//
// - Quadro RT, sezione II-A (26%): corrispettivi e costi di tutte le vendite dell'anno (rigo RT11),
//   risultato (RT52), minus degli anni precedenti (RT13), imponibile (RT72) e imposta (RT73),
//   minus non compensate da riportare (RT102). Titoli di Stato al 48,08%.
// - Quadro RM, rigo RM31: redditi di capitale esteri al 26% sul lordo, un rigo per tipo e Stato
//   (H dividendi, B proventi di ETF e fondi esteri armonizzati, C prestito titoli, G interessi del conto).
// - Quadro RW: valore iniziale e finale dei titoli del conto estero, giorni e IVAFE (2 per mille).

import { countryOf, type Country } from './countries.ts'
import { categoryFor, computeFiscal, BOND_WEIGHT, plusNotCompensable, type FiscalEventInput, type ManualLoss } from './fiscal.ts'
import { num } from './fx.ts'
import type { CashflowLike, DividendRow } from './dividends.ts'
import type { RawPortfolio } from './portfolio.ts'
import type { FxLookup, RawAsset, RawTx } from './types.ts'
import { daysInYear, FOREIGN_ACCOUNT_FIXED, RATE_ORDINARY } from './wealthTax.ts'

export const SUBSTITUTE_TAX_RATE = 0.26
/** Sotto questa giacenza media il conto corrente estero non paga l'IVAFE fissa. */
export const CASH_IVAFE_THRESHOLD = 5000

/** In dichiarazione gli importi si scrivono in unità di euro (50 centesimi o più: per eccesso). */
export const toEuro = (x: number) => Math.round(x + 1e-9)

const yearOf = (date: string) => Number(date.slice(0, 4))

// ---------------------------------------------------------------- Quadro RT

export interface RtSale {
  key: string
  date: string
  assetId: string
  assetName: string
  side: 'long' | 'short'
  /** Importi già ridotti al 48,08% per i titoli di Stato (come vanno scritti nel rigo RT11). */
  proceedsEur: number
  costEur: number
  gainEur: number
  bond: boolean
}

export interface PriorLoss {
  year: number
  /** Ultimo anno in cui si può usare. */
  expiresYear: number
  availableEur: number
  usedEur: number
  /** Quanto resta dopo questa dichiarazione (0 se scade quest'anno). */
  carriedEur: number
  /** Inserita a mano (es. minus di anni precedenti o certificate da un altro intermediario). */
  manual: boolean
}

export interface QuadroRT {
  year: number
  sales: RtSale[]
  /** RT11 col. 1 e col. 2. */
  proceedsEur: number
  costEur: number
  /** RT52: positivo = plusvalenza (col. 2), negativo = minusvalenza (col. 1). */
  netEur: number
  priorLosses: PriorLoss[]
  /** RT13 = RT71 col. 3: minus degli anni precedenti usate (non oltre la plusvalenza). */
  usedLossesEur: number
  /** RT72 imponibile, RT73 imposta 26% (= RT74 senza eccedenze dell'anno prima). */
  taxableEur: number
  taxEur: number
  /** RT102 col. 5: minus dell'anno da riportare. */
  newLossEur: number
  /** Plus di ETF e fondi: sono redditi di capitale, vanno nel quadro RM (lettera B), non qui. */
  etfGains: FiscalEventInput[]
  /** Cripto-attività (sezione V-A): solo i totali, da completare a parte. */
  crypto: { proceedsEur: number; costEur: number; netEur: number; count: number } | null
}

/**
 * Quadro RT dell'anno. `events` = tutte le vendite del portafoglio (anche degli anni precedenti:
 * servono a ricostruire le minus ancora da usare); `manualLosses` = minus inserite a mano.
 */
export function computeQuadroRT(events: FiscalEventInput[], manualLosses: ManualLoss[], year: number): QuadroRT {
  // Minus disponibili all'inizio dell'anno: il cassetto calcolato sugli anni precedenti.
  const manualUpTo = manualLosses.filter(m => m.date && yearOf(m.date) <= year)
  const prior = computeFiscal(events.filter(e => yearOf(e.date) < year), manualUpTo, 'dichiarativo')
  const manualYears = new Set(manualUpTo.map(m => yearOf(m.date)))
  const buckets = prior.buckets
    .filter(b => b.category === 'strumenti' && b.remainingEur > 0.005 && b.year <= year && b.expiresYear >= year)
    .sort((a, b) => a.year - b.year)

  const sales: RtSale[] = []
  const etfGains: FiscalEventInput[] = []
  let crypto: QuadroRT['crypto'] = null
  events.forEach((e, i) => {
    if (yearOf(e.date) !== year) return
    if (categoryFor(e.assetType) === 'crypto') {
      crypto ??= { proceedsEur: 0, costEur: 0, netEur: 0, count: 0 }
      crypto.proceedsEur += e.proceedsEur
      crypto.costEur += e.costEur
      crypto.netEur += e.gainEur
      crypto.count++
      return
    }
    if (plusNotCompensable(e.assetType) && e.gainEur > 0.005) {
      etfGains.push(e)
      return
    }
    const bond = e.assetType === 'bond'
    const w = bond ? BOND_WEIGHT : 1
    sales.push({
      key: `${e.assetId}#${e.txId ?? e.date}#${i}`, date: e.date, assetId: e.assetId, assetName: e.assetName, side: e.side,
      proceedsEur: e.proceedsEur * w, costEur: e.costEur * w, gainEur: e.gainEur * w, bond,
    })
  })
  sales.sort((a, b) => a.date.localeCompare(b.date))

  const proceedsEur = sales.reduce((s, x) => s + x.proceedsEur, 0)
  const costEur = sales.reduce((s, x) => s + x.costEur, 0)
  const netEur = proceedsEur - costEur
  const plus = Math.max(0, netEur)

  // Le minus più vecchie si usano per prime, fino a coprire la plusvalenza.
  let left = plus
  const priorLosses: PriorLoss[] = buckets.map(b => {
    const used = Math.min(b.remainingEur, left)
    left -= used
    const rest = b.remainingEur - used
    return {
      year: b.year, expiresYear: b.expiresYear, availableEur: b.remainingEur, usedEur: used,
      carriedEur: b.expiresYear > year ? rest : 0, manual: manualYears.has(b.year),
    }
  })
  const usedLossesEur = priorLosses.reduce((s, p) => s + p.usedEur, 0)
  const taxableEur = plus - usedLossesEur

  return {
    year, sales, proceedsEur, costEur, netEur, priorLosses, usedLossesEur, taxableEur,
    taxEur: taxableEur * SUBSTITUTE_TAX_RATE, newLossEur: Math.max(0, -netEur), etfGains, crypto,
  }
}

// ---------------------------------------------------------------- Quadro RM

export type RmLetter = 'B' | 'C' | 'G' | 'H'

export const RM_LETTERS: Record<RmLetter, string> = {
  B: 'Proventi di ETF e fondi esteri armonizzati (anche le plus da vendita)',
  C: 'Prestito titoli garantito (es. SYEP di IBKR)',
  G: 'Interessi del conto estero e azioni premio maturate',
  H: 'Dividendi esteri',
}

export interface RmItem {
  letter: RmLetter
  /** Codice ISO dello Stato in cui è prodotto il reddito (null = non noto). */
  iso: string | null
  date: string
  label: string
  grossEur: number
  withholdingEur: number
}

export interface RmRow {
  letter: RmLetter
  iso: string | null
  country: Country | null
  /** Col. 3: lordo, prima delle ritenute estere. */
  grossEur: number
  /** Ritenute estere pagate: solo informative, nessun credito (col. 5 vuota). */
  withholdingEur: number
  /** Col. 4 aliquota e col. 8 imposta dovuta. */
  ratePct: number
  taxEur: number
  items: RmItem[]
}

export interface QuadroRM {
  rows: RmRow[]
  grossEur: number
  withholdingEur: number
  taxEur: number
}

/** Un rigo RM31 per ogni coppia tipo di reddito + Stato estero. */
export function computeQuadroRM(items: RmItem[]): QuadroRM {
  const byKey = new Map<string, RmRow>()
  for (const it of items) {
    const key = `${it.letter}|${it.iso ?? '?'}`
    const row = byKey.get(key) ?? {
      letter: it.letter, iso: it.iso, country: countryOf(it.iso), grossEur: 0, withholdingEur: 0,
      ratePct: SUBSTITUTE_TAX_RATE * 100, taxEur: 0, items: [],
    }
    row.grossEur += it.grossEur
    row.withholdingEur += it.withholdingEur
    row.items.push(it)
    byKey.set(key, row)
  }
  const rows = [...byKey.values()]
    .map(r => ({ ...r, taxEur: Math.max(0, r.grossEur) * SUBSTITUTE_TAX_RATE, items: r.items.sort((a, b) => a.date.localeCompare(b.date)) }))
    .sort((a, b) => a.letter.localeCompare(b.letter) || (a.iso ?? '~').localeCompare(b.iso ?? '~'))
  return {
    rows,
    grossEur: rows.reduce((s, r) => s + r.grossEur, 0),
    withholdingEur: rows.reduce((s, r) => s + r.withholdingEur, 0),
    taxEur: rows.reduce((s, r) => s + r.taxEur, 0),
  }
}

const norm = (s: string | undefined) => (s || '').trim().toUpperCase()

export interface RmSources {
  year: number
  assets: Record<string, RawAsset & { isin?: string }>
  /** Dividendi già raggruppati (titolo + giorno), es. da `dividendsFromCashflows`. */
  dividends: DividendRow[]
  cashflows: CashflowLike[]
  etfGains: FiscalEventInput[]
  fx: FxLookup
  /** Stato del broker (per interessi e prestito titoli): IBKR per i clienti italiani di solito è in Irlanda. */
  brokerIso: string
}

/** Raccoglie i redditi di capitale dell'anno da dividendi, movimenti di cassa e plus di ETF. */
export function rmItemsFrom(s: RmSources): RmItem[] {
  // Titolo del dividendo: per ISIN se il movimento lo riporta, poi per ticker (anche senza suffisso di borsa, es. AHLA.DE).
  const bySymbol = new Map<string, RawAsset & { isin?: string }>()
  const byIsin = new Map<string, RawAsset & { isin?: string }>()
  for (const [id, a] of Object.entries(s.assets)) {
    const sym = norm(a.ticker || a.nome || id)
    bySymbol.set(sym, a)
    if (!bySymbol.has(sym.split('.')[0]!)) bySymbol.set(sym.split('.')[0]!, a)
    if (a.isin) byIsin.set(norm(a.isin), a)
  }
  const items: RmItem[] = []

  for (const d of s.dividends) {
    // Righe di sola ritenuta senza dividendo (rettifiche di pochi centesimi): non sono redditi da dichiarare.
    if (d.year !== s.year || Math.abs(d.grossEur) < 0.005) continue
    const a = (d.isin && byIsin.get(norm(d.isin))) || bySymbol.get(norm(d.symbol)) || bySymbol.get(norm(d.symbol).split('.')[0]!)
    const fund = a ? plusNotCompensable(a.tipoAsset) : false
    const isin = d.isin || a?.isin
    items.push({
      letter: fund ? 'B' : 'H', iso: isin ? isin.slice(0, 2).toUpperCase() : null, date: d.date,
      label: d.symbol || 'Dividendo', grossEur: d.grossEur, withholdingEur: d.withholdingEur,
    })
  }

  for (const f of s.cashflows) {
    if (!f?.date || yearOf(f.date) !== s.year) continue
    const letter: RmLetter | null = f.kind === 'credit-interest' ? 'G' : f.kind === 'lending' ? 'C' : null
    if (!letter) continue
    const currency = norm(f.currency) || 'EUR'
    const saved = num(f.exchangeRate)
    const rate = currency === 'EUR' ? 1 : saved > 0 ? saved : s.fx(currency, f.date)
    if (!rate || rate <= 0) continue
    items.push({
      letter, iso: s.brokerIso, date: f.date, label: letter === 'G' ? 'Interessi attivi' : 'Prestito titoli',
      grossEur: num(f.amount) / rate, withholdingEur: 0,
    })
  }

  // Azioni premio del broker maturate: il valore al vesting è reddito di capitale (premio legato al deposito).
  for (const [id, a] of Object.entries(s.assets)) {
    const currency = norm(a.valuta) || 'EUR'
    for (const t of a.transactions ?? []) {
      if (!t?.bonusKey || !t.date || yearOf(t.date) !== s.year) continue
      const saved = num(t.exchangeRate)
      const rate = currency === 'EUR' ? 1 : saved > 0 ? saved : s.fx(currency, t.date)
      if (!rate || rate <= 0) continue
      items.push({
        letter: 'G', iso: s.brokerIso, date: t.date, label: `Azioni premio ${(a.ticker || a.nome || id).trim()} maturate (${num(t.qty)})`,
        grossEur: (num(t.qty) * num(t.price)) / rate, withholdingEur: 0,
      })
    }
  }

  for (const e of s.etfGains) {
    const a = s.assets[e.assetId]
    items.push({
      letter: 'B', iso: a?.isin ? a.isin.slice(0, 2).toUpperCase() : null, date: e.date,
      label: `${e.assetName} (plus da vendita)`, grossEur: e.gainEur, withholdingEur: 0,
    })
  }
  return items
}

// ---------------------------------------------------------------- Quadro RW

/** Periodo di possesso di una quantità nell'anno (LIFO, come chiedono le istruzioni). */
export interface RwPiece {
  qty: number
  start: string
  end: string
  /** Prezzo in valuta del titolo: d'acquisto (o chiusura al 31/12 dell'anno prima) e di vendita (o chiusura a fine anno). */
  startPrice: number | null
  endPrice: number | null
  /** true = si usa la chiusura di borsa, non il prezzo di un movimento. */
  startFromClose: boolean
  endFromClose: boolean
  days: number
}

const dayNum = (d: string) => Math.round(Date.parse(d + 'T12:00:00Z') / 86400000)
const daysBetween = (a: string, b: string) => dayNum(b) - dayNum(a) + 1

/**
 * Periodi di possesso nell'anno. Prima dell'anno si ricostruiscono le quantità con il LIFO;
 * le vendite dell'anno chiudono i lotti più recenti. Gli short non sono attività: non entrano.
 */
export function holdingPieces(txs: RawTx[], year: number, prices: { startClose?: number; endClose?: number }): RwPiece[] {
  const from = `${year}-01-01`
  const to = `${year}-12-31`
  type Lot = { qty: number; start: string; price: number | null; fromClose: boolean }
  const lots: Lot[] = []
  const pieces: RwPiece[] = []
  let opened = false

  const openYear = () => {
    if (opened) return
    opened = true
    for (const l of lots) {
      l.start = from
      l.price = prices.startClose ?? null
      l.fromClose = true
    }
  }

  for (const t of [...txs].filter(t => t?.date && t.date <= to).sort((a, b) => a.date.localeCompare(b.date))) {
    if (t.date >= from) openYear()
    const q = num(t.qty)
    if (!(q > 0)) continue
    const incoming = t.type === 'buy' || (t.type === 'transfer' && !!t.sourcePortfolioId)
    const outgoing = t.type === 'sell' || (t.type === 'transfer' && !t.sourcePortfolioId)
    if (incoming) {
      lots.push({ qty: q, start: t.date, price: num(t.price) || null, fromClose: false })
    } else if (outgoing) {
      let left = q
      for (let i = lots.length - 1; i >= 0 && left > 1e-9; i--) {
        const l = lots[i]!
        const take = Math.min(l.qty, left)
        if (t.date >= from) {
          pieces.push({
            qty: take, start: l.start, end: t.date, startPrice: l.price, endPrice: num(t.price) || null,
            startFromClose: l.fromClose, endFromClose: false, days: daysBetween(l.start, t.date),
          })
        }
        l.qty -= take
        left -= take
        if (l.qty <= 1e-9) lots.splice(i, 1)
      }
    }
  }
  openYear()
  for (const l of lots) {
    if (l.qty <= 1e-9) continue
    pieces.push({
      qty: l.qty, start: l.start, end: to, startPrice: l.price, endPrice: prices.endClose ?? null,
      startFromClose: l.fromClose, endFromClose: true, days: daysBetween(l.start, to),
    })
  }
  return pieces
}

export interface RwHolding {
  assetId: string
  symbol: string
  isin: string | null
  currency: string
  pieces: RwPiece[]
  /** Col. 7 e col. 8, in euro al cambio medio mensile della Banca d'Italia. */
  startEur: number
  endEur: number
  /** Giorni di possesso, media pesata sul valore finale. */
  days: number
  ivafeEur: number
  /** Cosa manca per un valore affidabile (prezzo o cambio). */
  missing: string[]
}

/** Cambio medio mensile: unità di valuta per 1 EUR nel mese `YYYY-MM`. */
export type MonthlyFx = (currency: string, month: string) => number | undefined

export function valueHolding(
  assetId: string,
  asset: RawAsset & { isin?: string },
  year: number,
  prices: { startClose?: number; endClose?: number },
  monthlyFx: MonthlyFx,
): RwHolding | null {
  const pieces = holdingPieces(asset.transactions ?? [], year, prices)
  if (!pieces.length) return null
  const currency = norm(asset.valuta) || 'EUR'
  const symbol = (asset.ticker || asset.nome || assetId).trim()
  const missing = new Set<string>()
  const toEur = (amount: number, date: string) => {
    if (currency === 'EUR') return amount
    const r = monthlyFx(currency, date.slice(0, 7))
    if (!r) {
      missing.add(`cambio medio ${currency} di ${date.slice(0, 7)}`)
      return 0
    }
    return amount / r
  }
  let startEur = 0
  let endEur = 0
  let ivafeEur = 0
  let dayWeight = 0
  const diy = daysInYear(year)
  for (const p of pieces) {
    if (p.startPrice == null) missing.add(p.startFromClose ? `chiusura al 31/12/${year - 1}` : `prezzo del ${p.start}`)
    if (p.endPrice == null) missing.add(p.endFromClose ? `chiusura al 31/12/${year}` : `prezzo del ${p.end}`)
    const s = toEur(p.qty * (p.startPrice ?? 0), p.start)
    const e = toEur(p.qty * (p.endPrice ?? 0), p.end)
    startEur += s
    endEur += e
    ivafeEur += e * RATE_ORDINARY * Math.min(1, p.days / diy)
    dayWeight += e * p.days
  }
  const totalQtyDays = pieces.reduce((s, p) => s + p.qty * p.days, 0) / pieces.reduce((s, p) => s + p.qty, 0)
  return {
    assetId, symbol, isin: asset.isin ?? null, currency, pieces, startEur, endEur,
    days: Math.round(endEur > 0 ? dayWeight / endEur : totalQtyDays), ivafeEur, missing: [...missing],
  }
}

export interface QuadroRW {
  holdings: RwHolding[]
  /** Rigo unico per il deposito titoli (codice 20), con i valori di tutti i titoli. */
  deposit: { code: 20; iso: string; country: Country | null; startEur: number; endEur: number; days: number; ivafeEur: number }
  /** Conto corrente (codice 1): IVAFE fissa solo se la giacenza media supera 5.000 euro. */
  cash: { averageEur: number | null; ivafeEur: number; note: string }
  ivafeEur: number
}

export function computeQuadroRW(holdings: RwHolding[], brokerIso: string, cashAverageEur: number | null): QuadroRW {
  const startEur = holdings.reduce((s, h) => s + h.startEur, 0)
  const endEur = holdings.reduce((s, h) => s + h.endEur, 0)
  const ivafe = holdings.reduce((s, h) => s + h.ivafeEur, 0)
  const days = endEur > 0 ? holdings.reduce((s, h) => s + h.days * h.endEur, 0) / endEur : 0
  let cash: QuadroRW['cash']
  if (cashAverageEur == null) cash = { averageEur: null, ivafeEur: 0, note: 'Giacenza media del conto non nota: controllala sul rendiconto annuale IBKR.' }
  else if (cashAverageEur <= CASH_IVAFE_THRESHOLD) cash = { averageEur: cashAverageEur, ivafeEur: 0, note: `Giacenza media sotto ${CASH_IVAFE_THRESHOLD.toLocaleString('it-IT')} €: IVAFE non dovuta.` }
  else cash = { averageEur: cashAverageEur, ivafeEur: FOREIGN_ACCOUNT_FIXED, note: `Giacenza media sopra ${CASH_IVAFE_THRESHOLD.toLocaleString('it-IT')} €: IVAFE fissa di 34,20 €.` }
  return {
    holdings: [...holdings].sort((a, b) => b.endEur - a.endEur),
    deposit: { code: 20, iso: brokerIso, country: countryOf(brokerIso), startEur, endEur, days: Math.round(days), ivafeEur: ivafe },
    cash,
    ivafeEur: ivafe + cash.ivafeEur,
  }
}

// ---------------------------------------------------------------- Cambi

/** Copia dei portafogli senza i cambi salvati sui movimenti: il motore usa allora i cambi della Banca d'Italia. */
export function withoutSavedRates(portfolios: Record<string, RawPortfolio>): Record<string, RawPortfolio> {
  const out: Record<string, RawPortfolio> = {}
  for (const [pid, p] of Object.entries(portfolios)) {
    const assets: Record<string, RawAsset> = {}
    for (const [aid, a] of Object.entries(p.assets ?? {})) {
      assets[aid] = { ...a, transactions: (a.transactions ?? []).map(({ exchangeRate: _r, ...t }) => t) }
    }
    const flows = (p as { cashflows?: unknown }).cashflows
    const cashflows = flows && typeof flows === 'object'
      ? Object.fromEntries(Object.entries(flows as Record<string, CashflowLike>).map(([k, f]) => {
          const { exchangeRate: _r, ...rest } = f ?? {}
          return [k, rest]
        }))
      : flows
    out[pid] = { ...p, assets, ...(cashflows !== undefined ? { cashflows } : {}) } as RawPortfolio
  }
  return out
}

export interface FxCompareRow {
  key: string
  date: string
  symbol: string
  type: string
  currency: string
  amountNative: number
  /** Cambio salvato sul movimento (quello di IBKR) e cambio ufficiale Banca d'Italia del giorno. */
  savedRate: number
  bdiRate: number
  /** Differenza in euro: importo al cambio IBKR − importo al cambio Banca d'Italia. */
  diffEur: number
  diffPct: number
}

/** Movimenti dell'anno in valuta con il cambio salvato, confrontati con il cambio Banca d'Italia. */
export function compareRates(assets: Record<string, RawAsset>, year: number, fx: FxLookup): FxCompareRow[] {
  const rows: FxCompareRow[] = []
  for (const [aid, a] of Object.entries(assets)) {
    const currency = norm(a.valuta) || 'EUR'
    if (currency === 'EUR') continue
    ;(a.transactions ?? []).forEach((t, i) => {
      if (!t?.date || yearOf(t.date) !== year) return
      const saved = num(t.exchangeRate)
      const bdi = fx(currency, t.date)
      if (!(saved > 0) || !bdi) return
      const amountNative = num(t.qty) * num(t.price)
      rows.push({
        key: `${aid}#${t.id ?? i}`, date: t.date, symbol: (a.ticker || a.nome || aid).trim(), type: String(t.type), currency,
        amountNative, savedRate: saved, bdiRate: bdi, diffEur: amountNative / saved - amountNative / bdi,
        diffPct: (bdi / saved - 1) * 100,
      })
    })
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date))
}
