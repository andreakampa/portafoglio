// Sincronizzazione automatica: dal report Flex alle modifiche del portafoglio IBKR.
// Regole di sicurezza: mai doppioni (ogni ordine IBKR ha un id), e nel dubbio non si scrive
// ma si segnala ("da controllare"). Il report IBKR vince sui dati inseriti a mano solo quando
// il collegamento è certo (stesso titolo, giorno, tipo e quantità, prezzo entro l'1%).

import type { RawAsset, RawTx } from '../engine/types.ts'
import { yahooTicker, type FlexCash, type FlexMargin, type FlexOrder } from './flex.ts'

export interface SyncPortfolio {
  assets?: Record<string, RawAsset & { isin?: string; commDefault?: number }>
  /** Interessi di margine mensili (stesso formato del sito attuale). `parts` = costo di ogni addebito IBKR. */
  marginInterest?: MarginRow[]
  /** Dividendi, ritenute, interessi attivi, prestito titoli e commissioni del conto. Importo con segno. */
  cashflows?: CashflowRow[]
  /** Foto del margine all'ultimo report: saldo di cassa per valuta (negativo = margine usato), maturato, ultimo tasso. */
  marginStatus?: MarginStatus
  /** Una riga per giorno e valuta a debito: capitale, tasso e interesse del giorno. */
  marginDaily?: MarginDayRow[]
  /** Primo giorno coperto dallo storico del margine: da qui i giorni senza righe sono senza debito. */
  marginHistoryFrom?: string
}

export interface MarginStatus {
  date: string
  baseCurrency: string
  baseCash: number | null
  balances: { currency: string; endingCash: number; accrued: number; ratePct: number | null }[]
}

export interface MarginDayRow {
  date: string
  currency: string
  principal: number
  ratePct: number
  interest: number
}

export interface MarginRow {
  id?: string
  period: string
  currency: string
  amount: number
  source?: string
  externalId?: string
  parts?: Record<string, number>
}

export interface CashflowRow {
  id: string
  externalId: string
  source: 'ibkr'
  date: string
  kind: FlexCash['kind']
  symbol: string
  isin: string
  currency: string
  amount: number
  exchangeRate?: number
  description: string
}

export interface SyncResult {
  /** Portafoglio aggiornato (copia): da salvare solo se `changed`. */
  portfolio: SyncPortfolio
  changed: boolean
  added: string[]
  linked: string[]
  review: string[]
  skipped: string[]
  /** Movimenti di cassa importati (dividendi, interessi…). */
  cashAdded: string[]
}

type Tx = RawTx & { externalId?: string; source?: string }

const base = (t: string) => t.split('.')[0]!.replace(/[a-z]+$/, '').toUpperCase()
const days = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86400000
const label = (o: FlexOrder) => `${o.date} ${o.symbol} ${o.type} ${o.qty} @ ${+o.price.toFixed(4)} ${o.currency}`

export function applyFlexOrders(
  input: SyncPortfolio,
  orders: FlexOrder[],
  newId: () => string,
  cash: FlexCash[] = [],
  margin: FlexMargin | null = null,
): SyncResult {
  const portfolio: SyncPortfolio = structuredClone(input)
  const assets = (portfolio.assets ??= {})
  const res: SyncResult = { portfolio, changed: false, added: [], linked: [], review: [], skipped: [], cashAdded: [] }

  const already = new Set<string>()
  for (const a of Object.values(assets)) for (const t of (a.transactions ?? []) as Tx[]) if (t.externalId) already.add(t.externalId)

  // Lo stesso ISIN può stare su più mercati e valute (Alibaba: BABA in USD a New York, AHLA in EUR a Francoforte):
  // si cerca prima ISIN e valuta insieme, poi ticker e valuta, e solo per ultimo il solo ISIN.
  const cur = (a: RawAsset) => (a.valuta || 'EUR').toUpperCase()
  const findAsset = (o: FlexOrder) =>
    Object.entries(assets).find(([, a]) => o.isin && a.isin === o.isin && cur(a) === o.currency) ??
    Object.entries(assets).find(([, a]) => base(a.ticker || a.nome || '') === base(o.symbol) && cur(a) === o.currency) ??
    Object.entries(assets).find(([, a]) => o.isin && a.isin === o.isin)

  for (const o of orders) {
    if (already.has(o.externalId)) continue
    if (o.type === 'misto') {
      res.review.push(`${label(o)}: apre e chiude insieme, va diviso a mano`)
      continue
    }

    if (o.special === 'assigned' || o.special === 'exercised') {
      res.review.push(`${label(o)}: opzione ${o.special === 'assigned' ? 'assegnata' : 'esercitata'}, tocca anche il titolo sottostante: va registrata a mano`)
      continue
    }

    let hit = findAsset(o)
    if (!hit) {
      const isOpt = o.assetCategory === 'OPT'
      const ticker = isOpt ? o.symbol : yahooTicker(o.symbol, o.listingExchange)
      if (!ticker) {
        res.review.push(`${label(o)}: titolo nuovo su un mercato non riconosciuto (${o.listingExchange})`)
        continue
      }
      const id = 'ID' + newId()
      // Opzione: quantità = contratti × 100 e prezzo = premio per azione, ticker nel formato Yahoo (es. BMEA280121C00001500).
      assets[id] = { nome: isOpt && o.description ? o.description : ticker, ticker, isin: o.isin, valuta: o.currency, tipoAsset: isOpt ? 'option' : 'stock', commDefault: 0, transactions: [] }
      hit = [id, assets[id]!]
    }
    const [, asset] = hit
    const txs = (asset.transactions ??= []) as Tx[]
    const exact = { price: o.price, commission: o.commission, commissionCurrency: o.commissionCurrency, ...(o.exchangeRate ? { exchangeRate: o.exchangeRate } : {}) }

    // Movimento inserito a mano che è sicuramente questo ordine: lo si collega e corregge.
    const manual = txs.filter(t => !t.externalId)
    const sure = manual.find(t => t.type === o.type && t.date === o.date && Math.abs(+t.qty - o.qty) < 1e-6 && Math.abs(+t.price / o.price - 1) <= 0.01)
    if (sure) {
      Object.assign(sure, exact, { externalId: o.externalId })
      res.linked.push(label(o))
      res.changed = true
      continue
    }
    // Qualcosa di simile ma non uguale (data, tipo o prezzo diversi): meglio non creare doppioni.
    const similar = manual.find(
      t =>
        (days(t.date, o.date) <= 3 && Math.abs(+t.qty - o.qty) < 1e-6) || // stessa quantità, data vicina
        (t.date === o.date && t.type === o.type), // stesso giorno e tipo, quantità diversa
    )
    if (similar) {
      res.review.push(`${label(o)}: simile al movimento inserito a mano del ${similar.date} (${similar.type} ${similar.qty} @ ${similar.price})`)
      continue
    }

    txs.push({ id: newId(), externalId: o.externalId, source: 'ibkr', date: o.date, type: o.type, qty: o.qty, ...exact })
    txs.sort((a, b) => a.date.localeCompare(b.date))
    res.added.push(label(o))
    res.changed = true
  }
  applyCash(portfolio, cash, newId, res)
  if (margin) applyMargin(portfolio, margin, res)
  return res
}

const round = (x: number, d = 4) => Math.round(x * 10 ** d) / 10 ** d
const cashLabel = (c: FlexCash) => `${c.date} ${c.kind} ${c.symbol ? c.symbol + ' ' : ''}${round(c.amount, 2)} ${c.currency}`

/** Interessi di margine e altri movimenti di cassa. Idempotente: ogni addebito IBKR ha un id e si importa una sola volta. */
function applyCash(portfolio: SyncPortfolio, cash: FlexCash[], newId: () => string, res: SyncResult) {
  const hadFlows = !!portfolio.cashflows
  const flows = portfolio.cashflows ?? []
  const seen = new Set(flows.map(r => r.externalId))
  for (const r of portfolio.marginInterest ?? []) for (const k of Object.keys(r.parts ?? {})) seen.add(k)

  for (const c of cash) {
    if (seen.has(c.externalId)) continue

    if (c.kind === 'margin-interest') {
      if (!c.period) {
        res.review.push(`${cashLabel(c)}: interesse di margine senza mese nella descrizione (${c.description})`)
        continue
      }
      const rows = (portfolio.marginInterest ??= [])
      const key = `MI:${c.period}:${c.currency}`
      const cost = round(-c.amount) // costo positivo; uno storno diventa negativo
      let row = rows.find(r => r.externalId === key)
      if (!row) {
        const manual = rows.find(r => !r.externalId && r.period === c.period && (r.currency || 'EUR').toUpperCase() === c.currency)
        if (manual && Math.abs(+manual.amount - cost) > 0.01) {
          res.review.push(`${cashLabel(c)}: nel mese c'è già un interesse inserito a mano di ${manual.amount} ${c.currency}`)
          continue
        }
        row = manual ?? { id: 'MI' + newId(), period: c.period, currency: c.currency, amount: 0 }
        if (!manual) rows.push(row)
        Object.assign(row, { source: 'ibkr', externalId: key, parts: {} })
      }
      row.parts = { ...row.parts, [c.externalId]: cost }
      row.amount = round(Object.values(row.parts).reduce((a, b) => a + b, 0), 2)
      seen.add(c.externalId)
      res.cashAdded.push(cashLabel(c))
      res.changed = true
      continue
    }

    flows.push({
      id: 'CF' + newId(), externalId: c.externalId, source: 'ibkr', date: c.date, kind: c.kind, symbol: c.symbol, isin: c.isin,
      currency: c.currency, amount: round(c.amount), ...(c.exchangeRate ? { exchangeRate: c.exchangeRate } : {}), description: c.description,
    })
    seen.add(c.externalId)
    res.cashAdded.push(cashLabel(c))
    res.changed = true
  }
  if (flows.length > 0 || hadFlows) {
    flows.sort((a, b) => a.date.localeCompare(b.date))
    portfolio.cashflows = flows
  }
}

/** Saldo di cassa, maturato e tassi. Idempotente: il giorno già salvato non si tocca, la foto si aggiorna solo con un report più recente. */
function applyMargin(portfolio: SyncPortfolio, m: FlexMargin, res: SyncResult) {
  if (m.date && m.balances.length > 0 && (!portfolio.marginStatus || portfolio.marginStatus.date <= m.date)) {
    const lastRate = (cur: string) => [...m.days].reverse().find(d => d.currency === cur)?.ratePct ?? portfolio.marginStatus?.balances.find(b => b.currency === cur)?.ratePct ?? null
    const next: MarginStatus = {
      date: m.date,
      baseCurrency: m.baseCurrency,
      baseCash: m.baseCash,
      balances: m.balances.map(b => ({ ...b, ratePct: b.endingCash < 0 ? lastRate(b.currency) : null })),
    }
    if (JSON.stringify(next) !== JSON.stringify(portfolio.marginStatus)) {
      portfolio.marginStatus = next
      res.changed = true
    }
  }
  if (m.from && m.balances.length > 0 && (!portfolio.marginHistoryFrom || m.from < portfolio.marginHistoryFrom)) {
    portfolio.marginHistoryFrom = m.from
    res.changed = true
  }
  const rows = portfolio.marginDaily ?? []
  const seen = new Set(rows.map(r => `${r.date}|${r.currency}`))
  let added = false
  for (const d of m.days) {
    if (seen.has(`${d.date}|${d.currency}`)) continue
    rows.push({ date: d.date, currency: d.currency, principal: d.principal, ratePct: d.ratePct, interest: d.interest })
    added = true
  }
  if (added) {
    rows.sort((a, b) => a.date.localeCompare(b.date) || a.currency.localeCompare(b.currency))
    portfolio.marginDaily = rows
    res.changed = true
  }
}
