import { describe, expect, it } from 'vitest'
import type { DividendRow } from './engine/dividends.ts'
import type { FiscalLine } from './engine/fiscal.ts'
import type { PositionResult } from './engine/positions.ts'
import type { PositionRow } from './engine/valuation.ts'
import { positionsKpis } from './positionsKpis.ts'

const row = (p: Partial<PositionRow>): PositionRow => ({
  assetId: 'a', symbol: 'A', currency: 'USD', qty: 10, isShort: false, pmcNative: 10, costEur: 100, costTodayFxEur: 90, price: 12,
  valueEur: 110, unrealizedEur: 10, unrealizedPct: 10, dayChangePct: 0, realizedEur: 0, ...p,
})
const pos = (commissionsEur: number) => ({ commissionsEur }) as PositionResult
const line = (p: Partial<FiscalLine>): FiscalLine => ({
  key: 'k', assetId: 'a', assetName: 'A', assetType: 'stock', date: '2026-03-01', year: 2026, side: 'long',
  gainEur: 0, compensatedEur: 0, taxableEur: 0, taxEur: 0, excluded: null, ...p,
})
const div = (grossEur: number, withholdingEur: number) => ({ grossEur, withholdingEur }) as DividendRow

describe('positionsKpis', () => {
  const k = positionsKpis({
    rows: [
      // Long in USD: costo 100 € coi cambi storici, 90 € al cambio di oggi; vale 110 €.
      row({ assetId: 'a' }),
      // Short: incassati 50 € (45 al cambio di oggi), ora vale 40 €; guadagno fiscale 10.
      row({ assetId: 's', qty: -5, isShort: true, costEur: 50, costTodayFxEur: 45, valueEur: -40, unrealizedEur: 10 }),
      // Titolo di Stato in perdita: niente imposta.
      row({ assetId: 'b', currency: 'EUR', costEur: 200, costTodayFxEur: 200, valueEur: 190, unrealizedEur: -10 }),
      // Chiuso e senza prezzo: esclusi.
      row({ assetId: 'c', qty: 0, valueEur: null, unrealizedEur: null }),
    ],
    positions: { a: pos(2), s: pos(1), b: pos(0), c: pos(3) },
    assetTypes: { a: 'stock', s: 'stock', b: 'bond' },
    lines: [
      line({ gainEur: 300, taxEur: 78, year: 2025 }),
      line({ gainEur: -100, taxEur: 0 }),
      line({ gainEur: 200, taxEur: 26 }),
      line({ side: 'manuale', gainEur: -500 }),
    ],
    marginInterest: [{ period: '2026-01', currency: 'USD', amount: -10.8 }, { period: '2026-02', currency: 'EUR', amount: 5 }, { period: '2026-03', currency: 'XXX', amount: 9 }],
    dividends: [div(10, 1.5), div(20, 3)],
    latestFx: { USD: 1.08 },
    year: 2026,
  })

  it('portafoglio: investito al cambio di oggi, controvalore, commissioni di tutti i titoli', () => {
    expect(k.investedEur).toBeCloseTo(290)
    expect(k.valueEur).toBeCloseTo(110 + 190 + 5)
    expect(k.commissionsEur).toBe(6)
  })
  it('interessi di margine al cambio di oggi, valute senza cambio escluse', () => {
    expect(k.marginInterestEur).toBeCloseTo(15)
  })
  it('dividendi incassati = lordo meno ritenuta', () => {
    expect(k.dividendsGrossEur).toBe(30)
    expect(k.dividendsReceivedEur).toBeCloseTo(25.5)
  })
  it('imposta dell\'anno e realizzato da sempre (senza minus inserite a mano)', () => {
    expect(k.taxYearEur).toBe(26)
    expect(k.realizedGrossEur).toBe(400)
    expect(k.realizedNetEur).toBe(296)
  })
  it('non realizzato: vista broker, dopo le tasse e storico', () => {
    // broker: (110-90) + (45-40) + (190-200) = 15
    expect(k.unrealizedEur).toBeCloseTo(15)
    expect(k.unrealizedPct).toBeCloseTo((15 / 290) * 100)
    // tasse sul guadagno fiscale positivo: (10 + 10) × 26%
    expect(k.unrealizedTaxEur).toBeCloseTo(5.2)
    expect(k.afterTaxEur).toBeCloseTo(9.8)
    expect(k.totalAfterTaxEur).toBeCloseTo(296 + 9.8)
    expect(k.historicEur).toBeCloseTo(10)
    expect(k.historicPct).toBeCloseTo((10 / 300) * 100)
  })
  it('con l’imposta di uscita del simulatore usa quella (anche negativa = risparmio)', () => {
    const z = positionsKpis({ rows: [row({})], positions: {}, assetTypes: {}, lines: [], marginInterest: [], dividends: [], latestFx: {}, year: 2026, exitTaxEur: -3 })
    expect(z.unrealizedTaxEur).toBe(-3)
    expect(z.afterTaxEur).toBeCloseTo(20 + 3)
  })
  it('senza interessi di margine: null (il riquadro non si mostra)', () => {
    const z = positionsKpis({ rows: [], positions: {}, assetTypes: {}, lines: [], marginInterest: [], dividends: [], latestFx: {}, year: 2026 })
    expect(z.marginInterestEur).toBeNull()
    expect(z.unrealizedPct).toBeNull()
  })
})
