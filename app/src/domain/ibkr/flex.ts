// Lettura del report Flex di IBKR (XML) senza DOM: funziona nel browser e nel Worker Cloudflare.

export type FlexTradeType = 'buy' | 'sell' | 'short_sell' | 'buy_to_cover' | 'misto'

export interface FlexOrder {
  /** `${ibOrderID}@${data}`: stesso formato già usato dall'import del sito attuale. */
  externalId: string
  date: string // YYYY-MM-DD
  type: FlexTradeType
  symbol: string
  isin: string
  currency: string
  listingExchange: string
  qty: number
  price: number // prezzo medio ponderato delle esecuzioni
  commission: number
  commissionCurrency: string
  /** Unità di valuta del titolo per 1 EUR (inverso di fxRateToBase), se la base del conto è EUR. */
  exchangeRate: number | null
}

export type FlexCashKind = 'dividend' | 'pil' | 'withholding' | 'margin-interest' | 'credit-interest' | 'lending' | 'fee'

/** Movimento di cassa del conto (dividendo, ritenuta, interesse…). Importo con segno: positivo = entrata. */
export interface FlexCash {
  /** `C${transactionID}`: stesso formato del sito attuale. */
  externalId: string
  date: string // YYYY-MM-DD
  kind: FlexCashKind
  symbol: string
  isin: string
  currency: string
  amount: number
  /** Unità di valuta per 1 EUR (inverso di fxRateToBase), se la base del conto è EUR. */
  exchangeRate: number | null
  description: string
  /** Mese di competenza (YYYY-MM) per gli interessi, ricavato dalla descrizione ("DEBIT INT FOR OCT-2026"). */
  period: string | null
}

export interface FlexReport {
  from: string | null
  to: string | null
  baseCurrency: string
  orders: FlexOrder[]
  cash: FlexCash[]
  /** Tipi di movimento di cassa che non sappiamo gestire (nome → quanti). */
  unknownCash: Record<string, number>
  /** Operazioni non su azioni (opzioni, forex…): non importate, solo segnalate. */
  skipped: { symbol: string; category: string; date: string }[]
}

const unescape = (s: string) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

export function tags(xml: string, name: string): Record<string, string>[] {
  const out: Record<string, string>[] = []
  for (const m of xml.matchAll(new RegExp(`<${name}\\s([^>]*?)/?>`, 'g'))) {
    const attrs: Record<string, string> = {}
    for (const a of m[1]!.matchAll(/([\w:]+)="([^"]*)"/g)) attrs[a[1]!] = unescape(a[2]!)
    out.push(attrs)
  }
  return out
}

const iso = (d: string | undefined) => (d && /^\d{8}/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : null)
const n = (s: string | undefined) => {
  const v = parseFloat(s ?? '')
  return Number.isFinite(v) ? v : 0
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
/** 'DEBIT INT FOR OCT-2026' → '2026-10' */
export function monthOf(text: string): string | null {
  const m = /([A-Z]{3})-(\d{4})/.exec(text.toUpperCase())
  const i = m ? MONTHS.indexOf(m[1]!) : -1
  return m && i >= 0 ? `${m[2]}-${String(i + 1).padStart(2, '0')}` : null
}

// Tipi di CashTransaction di IBKR che ignoriamo di proposito (non sono redditi né costi del portafoglio).
const IGNORED_CASH = new Set(['Deposits/Withdrawals', 'Deposits & Withdrawals', 'Commission Adjustments', 'Cash Receipts'])

interface Building extends Omit<FlexOrder, 'type' | 'price'> {
  side: 'BUY' | 'SELL'
  notional: number
  opens: boolean
  closes: boolean
}

export function parseFlex(xml: string): FlexReport {
  if (!xml.includes('<FlexQueryResponse')) throw new Error('Non è un report Flex di IBKR')
  const stmt = tags(xml, 'FlexStatement')[0] ?? {}
  const info = tags(xml, 'AccountInformation')[0]
  const baseCurrency = (info?.currency || 'EUR').toUpperCase()
  const orders = new Map<string, Building>()
  const skipped: FlexReport['skipped'] = []

  for (const t of tags(xml, 'Trade')) {
    const date = iso(t.tradeDate)
    if (!date) continue
    if (t.levelOfDetail && t.levelOfDetail !== 'EXECUTION') continue
    if (t.assetCategory !== 'STK') {
      skipped.push({ symbol: t.symbol ?? '', category: t.assetCategory ?? '', date })
      continue
    }
    // Più esecuzioni dello stesso ordine nello stesso giorno = un solo movimento.
    const key = `${t.ibOrderID || t.tradeID}@${date}`
    let o = orders.get(key)
    if (!o) {
      const fx = n(t.fxRateToBase)
      o = {
        externalId: key, date, symbol: t.symbol ?? '', isin: t.isin ?? '',
        currency: (t.currency || 'USD').toUpperCase(), listingExchange: t.listingExchange ?? '',
        qty: 0, notional: 0, commission: 0,
        commissionCurrency: (t.ibCommissionCurrency || t.currency || 'USD').toUpperCase(),
        exchangeRate: baseCurrency === 'EUR' && fx > 0 ? 1 / fx : null,
        side: t.buySell === 'SELL' ? 'SELL' : 'BUY', opens: false, closes: false,
      }
      orders.set(key, o)
    }
    const oc = (t.openCloseIndicator ?? '').split(';')
    o.opens ||= oc.includes('O')
    o.closes ||= oc.includes('C')
    const qty = Math.abs(n(t.quantity))
    o.qty += qty
    o.notional += qty * n(t.tradePrice)
    o.commission += Math.abs(n(t.ibCommission))
  }

  const cash: FlexCash[] = []
  const unknownCash: Record<string, number> = {}
  for (const c of tags(xml, 'CashTransaction')) {
    if (c.levelOfDetail && c.levelOfDetail !== 'DETAIL') continue
    const date = iso(c.dateTime) ?? iso(c.reportDate)
    if (!date || !c.transactionID) continue
    const description = c.description ?? ''
    const type = c.type ?? ''
    let kind: FlexCashKind | null = null
    if (type === 'Dividends') kind = 'dividend'
    else if (type === 'Payment In Lieu Of Dividends') kind = 'pil'
    else if (type === 'Withholding Tax') kind = 'withholding'
    else if (type === 'Broker Interest Paid') kind = 'margin-interest'
    else if (type === 'Broker Interest Received') kind = /SYEP/i.test(description) ? 'lending' : 'credit-interest'
    else if (type === 'Other Fees') kind = 'fee'
    if (!kind) {
      if (!IGNORED_CASH.has(type)) unknownCash[type || '(senza tipo)'] = (unknownCash[type || '(senza tipo)'] ?? 0) + 1
      continue
    }
    const fx = n(c.fxRateToBase)
    cash.push({
      externalId: `C${c.transactionID}`, date, kind, symbol: c.symbol ?? '', isin: c.isin ?? '',
      currency: (c.currency || 'USD').toUpperCase(), amount: n(c.amount),
      exchangeRate: baseCurrency === 'EUR' && fx > 0 ? 1 / fx : null,
      description, period: monthOf(description),
    })
  }
  cash.sort((a, b) => a.date.localeCompare(b.date) || a.externalId.localeCompare(b.externalId))

  const result: FlexOrder[] = [...orders.values()].map(({ side, notional, opens, closes, ...o }) => ({
    ...o,
    type: opens && closes ? 'misto' : side === 'BUY' ? (closes ? 'buy_to_cover' : 'buy') : opens ? 'short_sell' : 'sell',
    price: o.qty ? notional / o.qty : 0,
  }))
  result.sort((a, b) => a.date.localeCompare(b.date) || a.externalId.localeCompare(b.externalId))
  return { from: iso(stmt.fromDate), to: iso(stmt.toDate), baseCurrency, orders: result, cash, unknownCash, skipped }
}

/** Ticker Yahoo a partire da simbolo e mercato IBKR (RACEm su BVME → RACE.MI). null = mercato non riconosciuto. */
export function yahooTicker(symbol: string, listingExchange: string): string | null {
  const base = symbol.replace(/[a-z]+$/, '').replace(/\s+/g, '-')
  const suffix: Record<string, string> = {
    BVME: '.MI', 'BVME.ETF': '.MI', IBIS: '.DE', IBIS2: '.DE', FWB: '.F', SBF: '.PA', AEB: '.AS', LSE: '.L',
    VENTURE: '.V', TSE: '.TO', SWX: '.SW', EBS: '.SW', BM: '.MC',
  }
  const us = ['NASDAQ', 'NYSE', 'ARCA', 'AMEX', 'BATS', 'ISLAND', 'PINK', 'IEX', 'NYSENAT']
  if (us.includes(listingExchange)) return base
  const s = suffix[listingExchange]
  return s ? base + s : null
}
