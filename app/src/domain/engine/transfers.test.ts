import { describe, expect, it } from 'vitest'
import { computeAllPortfolios, computePortfolio, type RawPortfolio } from './portfolio.ts'

// Cambi storici: unità di USD per 1 EUR.
const rates: Record<string, number> = { '2026-01-10': 1.25, '2026-02-10': 1.0, '2026-06-01': 1.1, '2026-09-01': 2.0 }
const fx = (cur: string, d: string) => (cur === 'USD' ? rates[d] : undefined)

const src = (txs: unknown[]): RawPortfolio => ({
  taxRegime: 'amministrato',
  assets: { m: { ticker: 'MSFT', valuta: 'USD', transactions: txs as never } },
})
const dest = (txs: unknown[], regime = 'dichiarativo'): RawPortfolio => ({
  taxRegime: regime,
  assets: { m: { ticker: 'MSFT', valuta: 'USD', transactions: txs as never } },
})

const buy1 = { id: 'b1', date: '2026-01-10', type: 'buy', qty: 10, price: 100 } // 1000 USD a 1,25 = 800 EUR
const buy2 = { id: 'b2', date: '2026-02-10', type: 'buy', qty: 10, price: 100 } // 1000 USD a 1,00 = 1000 EUR
const out = (q: number, id = 'T1') => ({ id: 'o', date: '2026-09-01', type: 'transfer', qty: q, price: 100, destPortfolioId: 'D', transferId: id })
const inn = (q: number, id = 'T1') => ({ id: 'i', date: '2026-09-01', type: 'transfer', qty: q, price: 100, sourcePortfolioId: 'S', transferId: id })

describe('trasferimenti tra portafogli', () => {
  it('prima: il costo in EUR usava il cambio del giorno del trasferimento (sbagliato)', () => {
    const old = computePortfolio(dest([inn(10)]), fx)
    expect(old.positions.m!.costEur).toBeCloseTo(500, 8) // 1000 USD / 2,0
  })

  it('dopo: il costo resta quello degli acquisti originali', () => {
    const r = computeAllPortfolios({ S: src([buy1, buy2, out(10)]), D: dest([inn(10)]) }, fx)
    // amministrato: costo medio (800 + 1000) / 20 = 90 EUR l'uno → 10 azioni = 900 EUR
    expect(r.D!.positions.m!.qty).toBe(10)
    expect(r.D!.positions.m!.costEur).toBeCloseTo(900, 8)
    expect(r.D!.positions.m!.costNative).toBeCloseTo(1000, 8)
    expect(r.S!.positions.m!.qty).toBe(10)
    expect(r.S!.positions.m!.costEur).toBeCloseTo(900, 8)
  })

  it('la vendita a destinazione usa il costo originale: plus corretta', () => {
    const sell = { id: 's', date: '2026-09-02', type: 'sell', qty: 10, price: 120 }
    const r = computeAllPortfolios({ S: src([buy1, buy2, out(10)]), D: dest([inn(10), sell]) }, (c, d) => (c === 'USD' ? (d === '2026-09-02' ? 2.0 : rates[d]) : undefined))
    // incasso 1200 USD / 2,0 = 600 EUR contro costo 900 EUR: minus di 300
    expect(r.D!.positions.m!.realizedEur).toBeCloseTo(-300, 8)
  })

  it('in dichiarativo i lotti arrivati tornano al loro posto per data (LIFO)', () => {
    const own = { id: 'x', date: '2026-03-01', type: 'buy', qty: 5, price: 100 } // 500 USD, cambio 1,1? non c'è: usa un cambio noto
    const fx2 = (c: string, d: string) => (c === 'USD' ? ({ ...rates, '2026-03-01': 1.0 } as Record<string, number>)[d] : undefined)
    const sell = { id: 's', date: '2026-09-02', type: 'sell', qty: 5, price: 100 }
    const fx3 = (c: string, d: string) => (d === '2026-09-02' ? 1.0 : fx2(c, d))
    const r = computeAllPortfolios({ S: src([buy1, out(10)]), D: dest([own, inn(10), sell]) }, fx3)
    // LIFO per data: l'ultimo acquistato è quello del 01/03 (500 USD a 1,0 = 500 EUR): vendendo 5 si chiude quel lotto
    expect(r.D!.positions.m!.realized[0]!.costEur).toBeCloseTo(500, 8)
  })

  it('più acquisti e trasferimento parziale: esce il costo medio, resta il resto', () => {
    const r = computeAllPortfolios({ S: src([buy1, buy2, out(5)]), D: dest([inn(5)]) }, fx)
    expect(r.D!.positions.m!.costEur).toBeCloseTo(450, 8)
    expect(r.S!.positions.m!.costEur).toBeCloseTo(1350, 8)
  })

  it('catena A→B→C', () => {
    const r = computeAllPortfolios(
      {
        S: src([buy1, out(10, 'T1')]),
        D: dest([inn(10, 'T1'), { id: 'o2', date: '2026-09-02', type: 'transfer', qty: 10, price: 100, destPortfolioId: 'E', transferId: 'T2' }]),
        E: dest([{ id: 'i2', date: '2026-09-02', type: 'transfer', qty: 10, price: 100, sourcePortfolioId: 'D', transferId: 'T2' }]),
      },
      (c, d) => (c === 'USD' ? (d === '2026-09-02' ? 3.0 : rates[d]) : undefined),
    )
    expect(r.E!.positions.m!.costEur).toBeCloseTo(800, 8)
  })

  it('entrata senza uscita collegata: vecchio calcolo e avviso', () => {
    const r = computeAllPortfolios({ D: dest([inn(10, 'nessuna')]) }, fx)
    expect(r.D!.positions.m!.costEur).toBeCloseTo(500, 8)
    expect(r.D!.issues.map(i => i.code)).toContain('trasferimento-non-collegato')
  })

  it('trasferimenti vecchi senza transferId: comportamento invariato, senza avvisi', () => {
    const old = { id: 'i', date: '2026-09-01', type: 'transfer', qty: 10, price: 100, sourcePortfolioId: 'S' }
    const r = computeAllPortfolios({ D: dest([old]) }, fx)
    expect(r.D!.positions.m!.costEur).toBeCloseTo(500, 8)
    expect(r.D!.issues).toHaveLength(0)
  })

  it('quantità diversa tra uscita e entrata: ricade sul vecchio calcolo con avviso', () => {
    const r = computeAllPortfolios({ S: src([buy1, out(10)]), D: dest([inn(8)]) }, fx)
    expect(r.D!.issues.map(i => i.code)).toContain('trasferimento-non-collegato')
  })

  it('giro A→B→A non si blocca', () => {
    const a = src([buy1, out(10, 'T1'), { id: 'i2', date: '2026-09-05', type: 'transfer', qty: 10, price: 100, sourcePortfolioId: 'D', transferId: 'T2' }])
    const d = dest([inn(10, 'T1'), { id: 'o2', date: '2026-09-03', type: 'transfer', qty: 10, price: 100, destPortfolioId: 'S', transferId: 'T2' }])
    const r = computeAllPortfolios({ S: a, D: d }, (c, dt) => (c === 'USD' ? rates[dt] ?? 1.5 : undefined))
    expect(r.S!.positions.m!.qty).toBe(10)
  })
})
