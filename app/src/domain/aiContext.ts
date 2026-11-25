// Riassunto del portafoglio da dare all'assistente AI: solo numeri utili, niente identificativi personali.
// Il Worker /chat taglia a 30.000 caratteri: qui si resta ben sotto.
// Di base (come nel sito vecchio) niente importi: solo titoli, pesi e percentuali. Con `amounts` anche euro, quantità e PMC.

import type { PortfolioResult, RawPortfolio } from './engine/portfolio.ts'
import type { PortfolioTotals, PositionRow } from './engine/valuation.ts'

const r2 = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 100) / 100)
const pct = (part: number | null | undefined, whole: number) => (part == null || !(whole > 0) ? null : r2((part / whole) * 100))

export interface AiContextInput {
  portfolio: RawPortfolio
  result: PortfolioResult
  rows: PositionRow[]
  totals: PortfolioTotals
  today: string
  /** true = manda anche importi in euro, quantità, prezzi e PMC. Di base solo percentuali. */
  amounts?: boolean
}

export function buildAiContext({ portfolio, result, rows, totals, today, amounts = false }: AiContextInput) {
  const year = Number(today.slice(0, 4))
  const lines = result.fiscal.lines.filter(l => l.year === year)
  const recent = Object.entries(portfolio.assets ?? {})
    .flatMap(([id, a]) => (a.transactions ?? []).map(t => ({ s: (a.ticker || a.nome || id).trim(), d: t.date, t: t.type, q: Number(t.qty), p: Number(t.price) })))
    .filter(m => m.d)
    .sort((a, b) => b.d.localeCompare(a.d))
    .slice(0, 25)
  const open = rows
    .filter(r => Math.abs(r.qty) > 1e-9)
    .sort((a, b) => Math.abs(b.valueEur ?? 0) - Math.abs(a.valueEur ?? 0))
    .slice(0, 60)
  const gross = open.reduce((s, r) => s + Math.abs(r.valueEur ?? 0), 0)
  const openLosses = result.fiscal.buckets.filter(b => b.remainingEur > 0.005 && b.expiresYear >= year)
  const base = {
    data: today,
    regimeFiscale: result.regime,
    note: result.regime === 'dichiarativo' ? 'broker estero: tasse in dichiarazione, costo LIFO' : 'intermediario italiano: tasse trattenute, costo medio',
  }

  if (!amounts) {
    return {
      ...base,
      privacy: 'importi in euro, quantità e prezzi non inviati: solo pesi e percentuali',
      totali: { risultatoPct: pct(totals.unrealizedEur, totals.investedEur) },
      posizioni: open.map(r => ({
        titolo: r.symbol, valuta: r.currency, short: r.isShort || undefined,
        pesoPct: pct(Math.abs(r.valueEur ?? 0), gross), risultatoPct: r2(r.unrealizedPct),
      })),
      fiscaleAnno: {
        anno: year,
        venditeInGuadagno: lines.filter(l => l.gainEur > 0.005).length,
        venditeInPerdita: lines.filter(l => l.gainEur < -0.005).length,
        minusDaUsare: openLosses.map(b => ({ anno: b.year, scadenza: b.expiresYear })),
      },
      ultimiMovimenti: recent.map(({ s, d, t }) => ({ s, d, t })),
    }
  }

  return {
    ...base,
    totali: { valoreEur: r2(totals.valueEur), costoEur: r2(totals.investedEur), nonRealizzatoEur: r2(totals.unrealizedEur) },
    posizioni: open.map(r => ({
      titolo: r.symbol, valuta: r.currency, quantita: r2(r.qty), short: r.isShort || undefined,
      pmc: r2(r.pmcNative), prezzo: r2(r.price), valoreEur: r2(r.valueEur), risultatoEur: r2(r.unrealizedEur), risultatoPct: r2(r.unrealizedPct),
    })),
    fiscaleAnno: {
      anno: year,
      plusEur: r2(lines.filter(l => l.gainEur > 0).reduce((s, l) => s + l.gainEur, 0)),
      minusEur: r2(-lines.filter(l => l.gainEur < 0).reduce((s, l) => s + l.gainEur, 0)),
      impostaEur: r2(lines.reduce((s, l) => s + l.taxEur, 0)),
      minusDisponibili: openLosses.map(b => ({ anno: b.year, scadenza: b.expiresYear, eur: r2(b.remainingEur) })),
    },
    ultimiMovimenti: recent,
  }
}
