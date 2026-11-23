// Ricerca del titolo su Yahoo (come api/search.js del sito vecchio): dal risultato grezzo a ticker, nome, valuta e tipo
// già pronti per il nuovo titolo.

export interface TickerHit {
  ticker: string
  name: string
  exchange: string
  currency: string
  /** Chiave di ASSET_TYPES (txEdit): stock, etf, fondo, bond, crypto, option. */
  tipoAsset: string
  typeLabel: string
}

interface YahooQuote {
  symbol?: string
  shortname?: string
  longname?: string
  quoteType?: string
  exchDisp?: string
  currency?: string
}

const EUR_SUFFIXES = ['.MI', '.DE', '.PA', '.AS', '.MC', '.BR', '.LS', '.VI', '.HE', '.F', '.XETRA', '.IR', '.SG', '.BE', '.DU', '.HM', '.MU']
const CAD_SUFFIXES = ['.TO', '.V', '.CN', '.NE']
const SUFFIX_CCY: Record<string, string> = {
  '.L': 'GBP', '.SW': 'CHF', '.T': 'JPY', '.HK': 'HKD', '.AX': 'AUD', '.MX': 'MXN', '.SA': 'BRL', '.NS': 'INR', '.BO': 'INR',
  '.KS': 'KRW', '.SS': 'CNY', '.SZ': 'CNY', '.TW': 'TWD', '.SI': 'SGD', '.NZ': 'NZD', '.JO': 'ZAR', '.WA': 'PLN', '.CO': 'DKK', '.OL': 'NOK', '.ST': 'SEK',
}

const TYPES: Record<string, [string, string]> = {
  EQUITY: ['stock', 'Azione'],
  ETF: ['etf', 'ETF'],
  MUTUALFUND: ['fondo', 'Fondo'],
  CRYPTOCURRENCY: ['crypto', 'Crypto'],
  BOND: ['bond', 'Obbligazione'],
  OPTION: ['option', 'Opzione'],
  FUTURE: ['stock', 'Future'],
  INDEX: ['stock', 'Indice'],
}

/** Valuta di quotazione: prima la borsa (suffisso del ticker), poi quella indicata da Yahoo. */
export function resolveCurrency(ticker: string, yahooCurrency?: string): string {
  const t = ticker.toUpperCase()
  const dot = t.lastIndexOf('.')
  const suffix = dot > 0 ? t.slice(dot) : ''
  if (EUR_SUFFIXES.includes(suffix)) return 'EUR'
  if (CAD_SUFFIXES.includes(suffix)) return 'CAD'
  if (SUFFIX_CCY[suffix]) return SUFFIX_CCY[suffix]
  if (t.endsWith('-EUR')) return 'EUR'
  if (t.endsWith('-USD')) return 'USD'
  const c = (yahooCurrency || '').trim()
  if (c === 'GBp') return 'GBP'
  return c ? c.toUpperCase() : 'USD'
}

export function parseSearch(raw: unknown): TickerHit[] {
  const quotes = ((raw as { quotes?: YahooQuote[] } | null)?.quotes ?? []).filter(q => q.symbol && q.quoteType !== 'CURRENCY')
  return quotes.map(q => {
    const [tipoAsset, typeLabel] = TYPES[(q.quoteType || '').toUpperCase()] ?? ['stock', q.quoteType || 'Altro']
    return {
      ticker: q.symbol!,
      name: q.shortname || q.longname || q.symbol!,
      exchange: q.exchDisp || '',
      currency: resolveCurrency(q.symbol!, q.currency),
      tipoAsset,
      typeLabel,
    }
  })
}

export const searchUrl = (q: string) =>
  `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q.trim())}&lang=it-IT&region=IT&quotesCount=8&newsCount=0`
