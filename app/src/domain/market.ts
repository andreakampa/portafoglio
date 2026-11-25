// Indicatori di mercato: soglia del VIX e stato del mercato. Funzioni pure.

/** Soglia di attenzione del VIX scelta da Andrea. */
export const VIX_ALERT = 25

/** Oltre questo valore il VIX indica paura estrema (lancetta e fascia rosse). */
export const VIX_EXTREME = 30

/** Fasce colorate della lancetta: verde fino a 20, giallo fino a 30, rosso oltre. */
export const VIX_BANDS: { from: number; to: number; key: 'good' | 'warning' | 'critical' }[] = [
  { from: 0, to: 20, key: 'good' },
  { from: 20, to: VIX_EXTREME, key: 'warning' },
  { from: VIX_EXTREME, to: 50, key: 'critical' },
]

/**
 * Stato del mercato secondo il VIX: sotto 20 calmo, fino alla soglia nervoso,
 * dalla soglia a 30 paura (giallo), da 30 paura estrema (rosso).
 */
export function vixStatus(v: number): { key: 'good' | 'warning' | 'critical'; label: string } {
  if (v >= VIX_EXTREME) return { key: 'critical', label: 'paura estrema' }
  if (v >= VIX_ALERT) return { key: 'warning', label: 'paura' }
  if (v >= 20) return { key: 'warning', label: 'nervoso' }
  return { key: 'good', label: 'calmo' }
}

/**
 * Un riquadro del pannello Mercati: simbolo Yahoo, nome e cifre decimali del prezzo.
 * `future`: il future che anticipa l'indice fuori orario (pre e post mercato).
 */
export interface MarketTile { symbol: string; name: string; decimals: number; future?: string }

/** Indici azionari e di volatilità (prima riga del pannello). */
export const INDEX_TILES: MarketTile[] = [
  { symbol: '^NDX', name: 'Nasdaq 100', decimals: 2, future: 'NQ=F' },
  { symbol: '^GSPC', name: 'S&P 500', decimals: 2, future: 'ES=F' },
  { symbol: '^VIX', name: 'VIX', decimals: 2 },
  { symbol: '^VXN', name: 'VXN', decimals: 2 },
]

/** Cambio euro/dollaro e crypto (in dollari), quotati 24 ore su 24 o quasi. */
export const FX_CRYPTO_TILES: MarketTile[] = [
  { symbol: 'EURUSD=X', name: 'EUR/USD', decimals: 4 },
  { symbol: 'BTC-USD', name: 'BTC ($)', decimals: 0 },
  { symbol: 'ETH-USD', name: 'ETH ($)', decimals: 2 },
]

/** Prezzo con le cifre decimali del riquadro, in formato italiano (es. 1,0523 o 87.432). */
export function formatTilePrice(v: number, decimals: number): string {
  return v.toLocaleString('it-IT', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

/** Variazione % del giorno rispetto alla chiusura precedente, null se manca. */
export function dayChange(price: number, previousClose: number | null | undefined): number | null {
  return previousClose ? ((price - previousClose) / previousClose) * 100 : null
}

/** Futures principali delle borse USA (seconda pagina del pannello): anticipano l'apertura. */
export const FUTURES_TILES: MarketTile[] = [
  { symbol: 'ES=F', name: 'S&P 500 fut.', decimals: 2 },
  { symbol: 'NQ=F', name: 'Nasdaq 100 fut.', decimals: 2 },
  { symbol: 'YM=F', name: 'Dow Jones fut.', decimals: 0 },
  { symbol: 'RTY=F', name: 'Russell 2000 fut.', decimals: 2 },
]

/**
 * Fase della borsa USA (ora di New York, festività escluse):
 * - `pre`: prima dell'apertura (00:00–09:30 dal lunedì al venerdì, e la domenica sera quando riaprono i futures);
 * - `regular`: seduta (09:30–16:00);
 * - `post`: sera dopo la chiusura (18:00–24:00 dal lunedì al giovedì), quando la chiusura di riferimento dei futures
 *   è già quella di oggi;
 * - `closed`: 16:00–18:00 (i futures si confrontano ancora con ieri) e il fine settimana.
 */
export type UsPhase = 'pre' | 'regular' | 'post' | 'closed'
export function usMarketPhase(d: Date): UsPhase {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(d)
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? ''
  const day = get('weekday') // Mon..Sun
  const min = Number(get('hour')) * 60 + Number(get('minute'))
  const weekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(day)
  if (day === 'Sun') return min >= 18 * 60 ? 'pre' : 'closed'
  if (!weekday) return 'closed'
  if (min < 9 * 60 + 30) return 'pre'
  if (min < 16 * 60) return 'regular'
  if (min >= 18 * 60 && day !== 'Fri') return 'post'
  return 'closed'
}

/** Sentiment di apertura: media delle variazioni dei futures; oltre ±0,3% positivo o negativo. */
export function openingSentiment(changes: (number | null)[]): { key: 'pos' | 'neg' | 'flat'; label: string; avg: number } | null {
  const xs = changes.filter((c): c is number => c !== null && Number.isFinite(c))
  if (!xs.length) return null
  const avg = xs.reduce((a, b) => a + b, 0) / xs.length
  if (avg > 0.3) return { key: 'pos', label: 'positivo', avg }
  if (avg < -0.3) return { key: 'neg', label: 'negativo', avg }
  return { key: 'flat', label: 'neutro', avg }
}
