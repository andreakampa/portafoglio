// Indicatori di mercato: soglia del VIX e stato del mercato. Funzioni pure.

/** Soglia di attenzione del VIX scelta da Andrea. */
export const VIX_ALERT = 25

/** Stato del mercato secondo il VIX: sotto 20 calmo, fino alla soglia nervoso, oltre paura. */
export function vixStatus(v: number): { key: 'good' | 'warning' | 'critical'; label: string } {
  if (v >= VIX_ALERT) return { key: 'critical', label: 'paura' }
  if (v >= 20) return { key: 'warning', label: 'nervoso' }
  return { key: 'good', label: 'calmo' }
}

/** Un riquadro del pannello Mercati: simbolo Yahoo, nome e cifre decimali del prezzo. */
export interface MarketTile { symbol: string; name: string; decimals: number }

/** Indici azionari e di volatilità (prima riga del pannello). */
export const INDEX_TILES: MarketTile[] = [
  { symbol: '^NDX', name: 'Nasdaq 100', decimals: 2 },
  { symbol: '^GSPC', name: 'S&P 500', decimals: 2 },
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
