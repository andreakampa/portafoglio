// Modello dei dati salvati in users/{uid}/portfolio_state (lo stesso del sito attuale).
// Qui solo i campi che servono oggi: il motore di calcolo completo arriva nella fase 1.

export type TaxRegime = 'amministrato' | 'dichiarativo'

export interface Transaction {
  id?: string
  date: string
  type: string
  qty: number
  price: number
  commission?: number
}

export interface Asset {
  nome?: string
  valuta?: string
  tipoAsset?: string
  transactions?: Transaction[]
}

export interface Portfolio {
  id: string
  name?: string
  taxRegime?: TaxRegime
  assets?: Record<string, Asset>
}

export interface PortfolioState {
  activePortfolioId?: string
  portfolios?: Record<string, Portfolio>
}

export interface PortfolioSummary {
  id: string
  name: string
  taxRegime: TaxRegime
  assets: number
  transactions: number
  active: boolean
}

/** Elenco dei portafogli per la panoramica, con nomi e regime sempre valorizzati. */
export function summarizePortfolios(state: PortfolioState | null | undefined): PortfolioSummary[] {
  const portfolios = state?.portfolios ?? {}
  return Object.entries(portfolios)
    .map(([key, p]) => {
      const assets = Object.values(p?.assets ?? {})
      return {
        id: p?.id || key,
        name: p?.name?.trim() || 'Portafoglio senza nome',
        taxRegime: p?.taxRegime === 'dichiarativo' ? 'dichiarativo' : 'amministrato',
        assets: assets.length,
        transactions: assets.reduce((n, a) => n + (Array.isArray(a?.transactions) ? a.transactions.length : 0), 0),
        active: (p?.id || key) === state?.activePortfolioId,
      } satisfies PortfolioSummary
    })
    .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, 'it'))
}
