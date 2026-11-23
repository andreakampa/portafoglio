// Visualizzazione della tabella Posizioni: valuta (€ o $) e peso di ogni titolo.
// Solo presentazione: i calcoli fiscali restano in euro con i cambi storici.
import type { PortfolioResult, RawPortfolio } from './engine/portfolio.ts'
import { symbolOf, valuePositions, type PositionRow, type QuoteLike } from './engine/valuation.ts'

export type DisplayCurrency = 'EUR' | 'USD'
export type WeightBase = 'portfolio' | 'all'

/** Importo in euro mostrato nella valuta scelta (`usdPerEur` = dollari per 1 euro). Senza cambio: null. */
export function toDisplay(eurAmount: number | null, currency: DisplayCurrency, usdPerEur: number | null): number | null {
  if (eurAmount === null) return null
  if (currency === 'EUR') return eurAmount
  return usdPerEur && usdPerEur > 0 ? eurAmount * usdPerEur : null
}

/** Valore di mercato lordo (long + |short|) delle posizioni aperte con prezzo: base dei pesi. */
export function grossValueEur(rows: PositionRow[]): number {
  return rows.reduce((s, r) => (r.qty !== 0 && r.valueEur !== null ? s + Math.abs(r.valueEur) : s), 0)
}

/** Peso % di ogni titolo aperto sulla base data (portafoglio o tutti i portafogli). */
export function weights(rows: PositionRow[], baseEur: number): Record<string, number> {
  const out: Record<string, number> = {}
  if (!(baseEur > 0)) return out
  for (const r of rows) if (r.qty !== 0 && r.valueEur !== null) out[r.assetId] = (Math.abs(r.valueEur) / baseEur) * 100
  return out
}

/** Simboli di tutti i portafogli (per caricare i prezzi quando il peso è su "Tutti"). */
export function allSymbols(portfolios: Record<string, RawPortfolio>): string[] {
  return [...new Set(Object.values(portfolios).flatMap(p => Object.entries(p.assets ?? {}).map(([id, a]) => symbolOf(a, id))))]
}

/** Valore lordo di tutti i portafogli insieme. */
export function allPortfoliosGrossEur(
  portfolios: Record<string, RawPortfolio>,
  results: Record<string, PortfolioResult>,
  quotes: Record<string, QuoteLike>,
  latestFx: Record<string, number>,
): number {
  let sum = 0
  for (const [id, p] of Object.entries(portfolios)) {
    const r = results[id]
    if (r) sum += grossValueEur(valuePositions(p.assets ?? {}, r.positions, quotes, latestFx))
  }
  return sum
}
