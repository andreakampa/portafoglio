// Riassunto del portafoglio da dare all'assistente AI: solo numeri utili, niente identificativi personali.
// Il Worker /chat taglia a 30.000 caratteri: qui si resta ben sotto.

import type { PortfolioResult, RawPortfolio } from './engine/portfolio.ts'
import type { PortfolioTotals, PositionRow } from './engine/valuation.ts'

const r2 = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 100) / 100)

export interface AiContextInput {
  portfolio: RawPortfolio
  result: PortfolioResult
  rows: PositionRow[]
  totals: PortfolioTotals
  today: string
}

export function buildAiContext({ portfolio, result, rows, totals, today }: AiContextInput) {
  const year = Number(today.slice(0, 4))
  const lines = result.fiscal.lines.filter(l => l.year === year)
  const recent = Object.entries(portfolio.assets ?? {})
    .flatMap(([id, a]) => (a.transactions ?? []).map(t => ({ s: (a.ticker || a.nome || id).trim(), d: t.date, t: t.type, q: Number(t.qty), p: Number(t.price) })))
    .filter(m => m.d)
    .sort((a, b) => b.d.localeCompare(a.d))
    .slice(0, 25)
  return {
    data: today,
    regimeFiscale: result.regime,
    note: result.regime === 'dichiarativo' ? 'broker estero: tasse in dichiarazione, costo LIFO' : 'intermediario italiano: tasse trattenute, costo medio',
    totali: { valoreEur: r2(totals.valueEur), costoEur: r2(totals.investedEur), nonRealizzatoEur: r2(totals.unrealizedEur) },
    posizioni: rows
      .filter(r => Math.abs(r.qty) > 1e-9)
      .sort((a, b) => Math.abs(b.valueEur ?? 0) - Math.abs(a.valueEur ?? 0))
      .slice(0, 60)
      .map(r => ({
        titolo: r.symbol, valuta: r.currency, quantita: r2(r.qty), short: r.isShort || undefined,
        pmc: r2(r.pmcNative), prezzo: r2(r.price), valoreEur: r2(r.valueEur), risultatoEur: r2(r.unrealizedEur), risultatoPct: r2(r.unrealizedPct),
      })),
    fiscaleAnno: {
      anno: year,
      plusEur: r2(lines.filter(l => l.gainEur > 0).reduce((s, l) => s + l.gainEur, 0)),
      minusEur: r2(-lines.filter(l => l.gainEur < 0).reduce((s, l) => s + l.gainEur, 0)),
      impostaEur: r2(lines.reduce((s, l) => s + l.taxEur, 0)),
      minusDisponibili: result.fiscal.buckets.filter(b => b.remainingEur > 0.005 && b.expiresYear >= year).map(b => ({ anno: b.year, scadenza: b.expiresYear, eur: r2(b.remainingEur) })),
    },
    ultimiMovimenti: recent,
  }
}
