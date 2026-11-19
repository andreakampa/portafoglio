// Imposte patrimoniali sugli investimenti (persone fisiche).
//
// - Imposta di bollo: 2 per mille annuo sul valore dei prodotti finanziari presso un
//   intermediario italiano (Mediolanum, Trade Republic Italia…). La versa l'intermediario.
// - IVAFE: stessa aliquota per i prodotti presso un intermediario estero (es. IBKR),
//   4 per mille se detenuti in un paradiso fiscale. Si paga con la dichiarazione dei redditi.
// - Conti correnti esteri: IVAFE fissa di 34,20 € l'anno.
// Tutte si rapportano ai giorni di possesso nell'anno.

export type WealthTaxKind = 'bollo' | 'ivafe'

export const RATE_ORDINARY = 0.002
export const RATE_TAX_HAVEN = 0.004
export const FOREIGN_ACCOUNT_FIXED = 34.2

export interface WealthTaxInput {
  kind: WealthTaxKind
  /** Valore di mercato in EUR a fine anno (o alla data di chiusura, se prima). */
  valueEur: number
  /** Giorni di possesso nell'anno (default: anno intero). */
  daysHeld?: number
  daysInYear?: number
  taxHaven?: boolean
}

export function wealthTax({ kind, valueEur, daysHeld, daysInYear = 365, taxHaven = false }: WealthTaxInput): number {
  if (!(valueEur > 0)) return 0
  const rate = kind === 'ivafe' && taxHaven ? RATE_TAX_HAVEN : RATE_ORDINARY
  const share = Math.min(1, Math.max(0, (daysHeld ?? daysInYear) / daysInYear))
  return valueEur * rate * share
}

/** Di regola: amministrato = intermediario italiano (bollo), dichiarativo = estero (IVAFE). */
export const wealthTaxKindFor = (regime: string | undefined): WealthTaxKind => (regime === 'dichiarativo' ? 'ivafe' : 'bollo')

export const daysInYear = (year: number) => ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 366 : 365)
