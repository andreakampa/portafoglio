// Rendiconto di attività IBKR (CSV, in italiano): lettura e confronto con i movimenti dell'app.
// Il rendiconto serve a controllare e completare i dati: i calcoli per la dichiarazione restano
// quelli del motore (LIFO, cambi Banca d'Italia), perché IBKR usa il FIFO e i suoi cambi.
// Funzioni pure, senza rete. Il file resta nel browser.

import { num } from '../engine/fx.ts'
import type { RawAsset, RawTx } from '../engine/types.ts'

/** Una riga CSV con campi tra virgolette (es. "2026-08-28, 11:19:26" o "1,515"). */
export function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let q = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!
    if (q) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"'
        i++
      } else if (ch === '"') q = false
      else cur += ch
    } else if (ch === '"') q = true
    else if (ch === ',') {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out
}

/** Numero del rendiconto: "1,134.00" → 1134; "--" o vuoto → 0. */
const n = (s: string | undefined) => num(String(s ?? '').replace(/,/g, ''))

const MONTHS: Record<string, string> = {
  gennaio: '01', febbraio: '02', marzo: '03', aprile: '04', maggio: '05', giugno: '06',
  luglio: '07', agosto: '08', settembre: '09', ottobre: '10', novembre: '11', dicembre: '12',
}

/** "Gennaio 1, 2026" → 2026-01-01. */
function itDate(s: string): string | null {
  const m = /^\s*([A-Za-zàèéìòù]+)\s+(\d{1,2}),\s*(\d{4})\s*$/.exec(s)
  const mm = m ? MONTHS[m[1]!.toLowerCase()] : undefined
  return m && mm ? `${m[3]}-${mm}-${m[2]!.padStart(2, '0')}` : null
}

export type StatementAssetClass = 'stock' | 'option'

export interface StatementTrade {
  assetClass: StatementAssetClass
  currency: string
  symbol: string
  date: string
  /** Con segno: positiva = acquisto (o ricopertura), negativa = vendita (o short). */
  qty: number
  price: number
  /** Commissioni e tasse, positive = pagate. */
  commission: number
  realizedPL: number
}

export interface StatementCash {
  currency: string
  date: string
  symbol: string
  isin: string | null
  description: string
  amount: number
}

export type InterestKind = 'credit' | 'debit' | 'syep'

export interface StatementInterest extends StatementCash {
  kind: InterestKind
}

export interface StatementPosition {
  assetClass: StatementAssetClass
  currency: string
  symbol: string
  qty: number
  /** Prezzo di chiusura all'ultimo giorno del rendiconto (per azione). */
  closePrice: number
  /** Valore in valuta (quantità × moltiplicatore × prezzo). */
  value: number
}

export interface StatementTransfer {
  currency: string
  symbol: string
  date: string
  direction: 'in' | 'out'
  qty: number
  marketValue: number
}

export interface IbkrStatement {
  broker: string
  from: string
  to: string
  trades: StatementTrade[]
  dividends: StatementCash[]
  withholdings: StatementCash[]
  interest: StatementInterest[]
  transfers: StatementTransfer[]
  positions: StatementPosition[]
  /** Simbolo → ISIN e descrizione (sezione "Informazioni sullo strumento finanziario"). */
  instruments: Record<string, { isin: string | null; description: string }>
  /** Saldo di cassa a fine periodo, in valuta base (dal "Valore patrimoniale netto"). */
  endCash: number | null
}

const assetClassOf = (s: string): StatementAssetClass | null =>
  s === 'Azioni' ? 'stock' : s.startsWith('Opzioni') ? 'option' : null

/** "MSFT(US5949181045) Dividendo..." → simbolo e ISIN. */
function symbolIsin(desc: string): { symbol: string; isin: string | null } {
  const m = /^\s*([^\s(]+)\s*\(([A-Z]{2}[A-Z0-9]{9}\d)\)/.exec(desc)
  if (m) return { symbol: m[1]!, isin: m[2]! }
  const s = /^\s*([^\s(]+)/.exec(desc)
  return { symbol: s?.[1] ?? '', isin: null }
}

/** Legge il CSV del rendiconto di attività IBKR in italiano. Errore se non lo riconosce. */
export function parseStatement(text: string): IbkrStatement {
  const st: IbkrStatement = {
    broker: '', from: '', to: '', trades: [], dividends: [], withholdings: [], interest: [], transfers: [], positions: [],
    instruments: {}, endCash: null,
  }
  const headers = new Map<string, string[]>()
  for (const raw of text.replace(/^﻿/, '').split(/\r?\n/)) {
    if (!raw.trim()) continue
    const cells = parseCsvLine(raw)
    const [section, kind] = cells
    if (!section) continue
    if (kind === 'Header') {
      headers.set(section, cells.slice(2))
      continue
    }
    if (kind !== 'Data') continue
    const h = headers.get(section) ?? []
    const row: Record<string, string> = {}
    h.forEach((name, i) => (row[name] = cells[i + 2] ?? ''))

    switch (section) {
      case 'Statement':
        if (cells[2] === 'BrokerName') st.broker = cells[3] ?? ''
        if (cells[2] === 'Period') {
          const [a, b] = (cells[3] ?? '').split(' - ')
          st.from = itDate(a ?? '') ?? ''
          st.to = itDate(b ?? '') ?? ''
        }
        break
      case 'Dettaglio eseguiti': {
        const cls = assetClassOf(row['Tipo di attivo'] ?? '')
        if (!cls || row['DataDiscriminator'] !== 'Order') break
        st.trades.push({
          assetClass: cls, currency: row['Valuta'] ?? '', symbol: row['Simbolo'] ?? '', date: (row['Data/ora'] ?? '').slice(0, 10),
          qty: n(row['Quantità']), price: n(row['Prezzo eseguito']), commission: -n(row['Comm./tasse']), realizedPL: n(row['P/L realizzato']),
        })
        break
      }
      case 'Dividendi':
      case 'Ritenute alla fonte': {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(row['Data'] ?? '')) break // righe "Totale"
        const { symbol, isin } = symbolIsin(row['Descrizione'] ?? '')
        const item = { currency: row['Valuta'] ?? '', date: row['Data']!, symbol, isin, description: row['Descrizione'] ?? '', amount: n(row['Importo']) }
        ;(section === 'Dividendi' ? st.dividends : st.withholdings).push(item)
        break
      }
      case 'Interessi': {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(row['Data'] ?? '')) break
        const d = row['Descrizione'] ?? ''
        const kind: InterestKind = /SYEP|titoli gestiti/i.test(d) ? 'syep' : /creditori/i.test(d) ? 'credit' : 'debit'
        st.interest.push({ currency: row['Valuta'] ?? '', date: row['Data']!, symbol: '', isin: null, description: d, amount: n(row['Importo']), kind })
        break
      }
      case 'Trasferimenti':
        if (row['Tipo di attivo'] !== 'Azioni') break
        st.transfers.push({
          currency: row['Valuta'] ?? '', symbol: row['Simbolo'] ?? '', date: row['Data'] ?? '',
          direction: /^in/i.test(row['Direzione'] ?? '') ? 'in' : 'out', qty: n(row['Q.tà']), marketValue: n(row['Valore di mercato']),
        })
        break
      case 'Posizioni aperte': {
        const cls = assetClassOf(row['Tipo di attivo'] ?? '')
        if (!cls || row['DataDiscriminator'] !== 'Summary') break
        st.positions.push({
          assetClass: cls, currency: row['Valuta'] ?? '', symbol: row['Simbolo'] ?? '', qty: n(row['Quantità']),
          closePrice: n(row['Prezzo di chiusura']), value: n(row['Valore']),
        })
        break
      }
      case 'Informazioni sullo strumento finanziario':
        if (row['Simbolo']) st.instruments[row['Simbolo']] = { isin: /^[A-Z]{2}[A-Z0-9]{10}$/.test(row['ID titolo'] ?? '') ? row['ID titolo']! : null, description: row['Descrizione'] ?? '' }
        break
      case 'Valore patrimoniale netto':
        if (row['Classe di asset'] === 'Liquidità') st.endCash = n(row['Totale corrente'])
        break
    }
  }
  if (!st.from || !st.to || !/interactive brokers/i.test(st.broker)) {
    throw new Error('Non sembra un rendiconto di attività IBKR in CSV (italiano).')
  }
  return st
}

// ---------------------------------------------------------------- Confronto con l'app

type Asset = RawAsset & { isin?: string }

/** Simbolo IBKR (es. RACEm, AHLA, "BMEA 21JAN28 1.5 C") → chiave di confronto. */
const key = (s: string) => s.trim().toUpperCase().replace(/\s+/g, ' ')

const MON: Record<string, string> = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' }

/** Opzione IBKR "BMEA 21JAN28 1.5 C" → ticker OCC usato nell'app "BMEA280121C00001500". null se non è un'opzione. */
export function occSymbol(symbol: string): string | null {
  const m = /^\s*([A-Z.]+)\s+(\d{2})([A-Z]{3})(\d{2})\s+([\d.]+)\s+([CP])\s*$/.exec(symbol.toUpperCase())
  const mm = m ? MON[m[3]!] : undefined
  if (!m || !mm) return null
  const strike = String(Math.round(parseFloat(m[5]!) * 1000)).padStart(8, '0')
  return `${m[1]}${m[4]}${mm}${m[2]}${m[6]}${strike}`
}

/** Trova il titolo dell'app che corrisponde a un simbolo del rendiconto: ISIN + valuta, poi ticker (anche senza suffisso di borsa). */
export function matchAsset(assets: Record<string, Asset>, st: IbkrStatement, symbol: string, currency: string): string | null {
  const isin = st.instruments[symbol]?.isin
  const cur = currency.toUpperCase()
  const entries = Object.entries(assets)
  const sameCur = (a: Asset) => (a.valuta || 'EUR').toUpperCase() === cur
  if (isin) {
    const hit = entries.find(([, a]) => a.isin === isin && sameCur(a)) ?? entries.find(([, a]) => a.isin === isin)
    if (hit) return hit[0]
  }
  const k = occSymbol(symbol) ?? key(symbol)
  const base = k.replace(/M$/, '') // IBKR aggiunge "m" ai titoli di Borsa Italiana (RACEm)
  const tickers = (a: Asset) => {
    const t = key(a.ticker || a.nome || '')
    return [t, t.split('.')[0]!]
  }
  const hit =
    entries.find(([, a]) => sameCur(a) && tickers(a).includes(k)) ??
    entries.find(([, a]) => sameCur(a) && tickers(a).includes(base)) ??
    entries.find(([, a]) => tickers(a).includes(k))
  return hit?.[0] ?? null
}

/** Quantità con segno di un movimento dell'app: positiva se aumenta la posizione long o chiude uno short. */
function signedQty(t: RawTx): number {
  const q = num(t.qty)
  switch (t.type) {
    case 'buy':
    case 'buy_to_cover':
      return q
    case 'sell':
    case 'short_sell':
      return -q
    default:
      return 0
  }
}

export interface TradeDiff {
  symbol: string
  currency: string
  date: string
  assetId: string | null
  /** Quantità netta del giorno nel rendiconto e nell'app. */
  statementQty: number
  appQty: number
}

export interface CashDiff {
  kind: 'dividendi' | 'ritenute' | 'interessi attivi' | 'prestito titoli'
  currency: string
  statement: number
  app: number
}

export interface PositionDiff {
  symbol: string
  currency: string
  assetId: string | null
  statementQty: number
  appQty: number
}

export interface StatementCheck {
  from: string
  to: string
  tradesChecked: number
  trades: TradeDiff[]
  cash: CashDiff[]
  positionsChecked: number
  positions: PositionDiff[]
  /** Rendiconto che arriva al 31/12: i suoi prezzi di chiusura valgono per il quadro RW. */
  yearEnd: boolean
}

export interface CashflowLike {
  date?: string
  kind?: string
  currency?: string
  amount?: number | string
}

const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol

/**
 * Confronta il rendiconto con i movimenti dell'app nello stesso periodo: operazioni per titolo e giorno,
 * totali dei movimenti di cassa per valuta, posizioni a fine periodo. Torna solo le differenze.
 */
export function checkStatement(st: IbkrStatement, assets: Record<string, Asset>, cashflows: CashflowLike[]): StatementCheck {
  const inPeriod = (d: string | undefined) => !!d && d >= st.from && d <= st.to

  // Operazioni: quantità netta per titolo e giorno (le opzioni nell'app hanno quantità = contratti × 100).
  const stmt = new Map<string, TradeDiff>()
  for (const t of st.trades) {
    const assetId = matchAsset(assets, st, t.symbol, t.currency)
    const k = `${assetId ?? 'nuovo:' + t.symbol}|${t.date}`
    const mult = t.assetClass === 'option' ? 100 : 1
    const d = stmt.get(k) ?? { symbol: t.symbol, currency: t.currency, date: t.date, assetId, statementQty: 0, appQty: 0 }
    d.statementQty += t.qty * mult
    stmt.set(k, d)
  }
  for (const [aid, a] of Object.entries(assets)) {
    for (const t of a.transactions ?? []) {
      if (!inPeriod(t?.date)) continue
      const q = signedQty(t)
      if (!q) continue
      const k = `${aid}|${t.date}`
      const d = stmt.get(k) ?? { symbol: a.ticker || a.nome || aid, currency: (a.valuta || 'EUR').toUpperCase(), date: t.date, assetId: aid, statementQty: 0, appQty: 0 }
      d.appQty += q
      stmt.set(k, d)
    }
  }
  const trades = [...stmt.values()].filter(d => !near(d.statementQty, d.appQty, 1e-4)).sort((a, b) => a.date.localeCompare(b.date))

  // Movimenti di cassa: totali per tipo e valuta.
  const cashTotals = new Map<string, CashDiff>()
  const add = (kind: CashDiff['kind'], currency: string, side: 'statement' | 'app', amount: number) => {
    const k = `${kind}|${currency}`
    const d = cashTotals.get(k) ?? { kind, currency, statement: 0, app: 0 }
    d[side] += amount
    cashTotals.set(k, d)
  }
  for (const d of st.dividends) add('dividendi', d.currency, 'statement', d.amount)
  for (const d of st.withholdings) add('ritenute', d.currency, 'statement', d.amount)
  for (const i of st.interest) {
    if (i.kind === 'credit') add('interessi attivi', i.currency, 'statement', i.amount)
    if (i.kind === 'syep') add('prestito titoli', i.currency, 'statement', i.amount)
  }
  for (const f of cashflows) {
    if (!inPeriod(f?.date)) continue
    const cur = (f.currency || 'EUR').toUpperCase()
    const amt = num(f.amount)
    if (f.kind === 'dividend' || f.kind === 'pil') add('dividendi', cur, 'app', amt)
    else if (f.kind === 'withholding') add('ritenute', cur, 'app', amt)
    else if (f.kind === 'credit-interest') add('interessi attivi', cur, 'app', amt)
    else if (f.kind === 'lending') add('prestito titoli', cur, 'app', amt)
  }
  const cash = [...cashTotals.values()].filter(d => !near(d.statement, d.app, 0.011))

  // Posizioni a fine periodo.
  const appQtyAt = (a: Asset) => (a.transactions ?? []).filter(t => t?.date && t.date <= st.to).reduce((s, t) => {
    const q = num(t.qty)
    if (t.type === 'transfer') return s + (t.sourcePortfolioId ? q : -q)
    return s + (t.type === 'buy' ? q : t.type === 'sell' ? -q : t.type === 'short_sell' ? -q : t.type === 'buy_to_cover' ? q : 0)
  }, 0)
  const seen = new Set<string>()
  const positions: PositionDiff[] = []
  for (const p of st.positions) {
    const assetId = matchAsset(assets, st, p.symbol, p.currency)
    if (assetId) seen.add(assetId)
    const mult = p.assetClass === 'option' ? 100 : 1
    const appQty = assetId ? appQtyAt(assets[assetId]!) : 0
    if (!near(p.qty * mult, appQty, 1e-4)) positions.push({ symbol: p.symbol, currency: p.currency, assetId, statementQty: p.qty * mult, appQty })
  }
  for (const [aid, a] of Object.entries(assets)) {
    if (seen.has(aid)) continue
    const q = appQtyAt(a)
    if (Math.abs(q) > 1e-4) positions.push({ symbol: a.ticker || a.nome || aid, currency: (a.valuta || 'EUR').toUpperCase(), assetId: aid, statementQty: 0, appQty: q })
  }

  return {
    from: st.from, to: st.to, tradesChecked: st.trades.length, trades, cash,
    positionsChecked: st.positions.length, positions, yearEnd: st.to.endsWith('-12-31'),
  }
}

/** Dati del rendiconto da conservare per il prospetto (niente movimenti: solo ciò che serve al quadro RW). */
export interface SavedStatement {
  from: string
  to: string
  importedAt: string
  /** Prezzo di chiusura a fine periodo per titolo dell'app (assetId → prezzo per azione). */
  closes: Record<string, number>
  endCash: number | null
}

export function summarizeStatement(st: IbkrStatement, assets: Record<string, Asset>, importedAt: string): SavedStatement {
  const closes: Record<string, number> = {}
  for (const p of st.positions) {
    const id = matchAsset(assets, st, p.symbol, p.currency)
    if (id && p.closePrice > 0) closes[id] = p.closePrice
  }
  return { from: st.from, to: st.to, importedAt, closes, endCash: st.endCash }
}
