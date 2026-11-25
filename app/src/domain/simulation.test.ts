import { describe, expect, it } from 'vitest'
import type { RawPortfolio } from './engine/portfolio'
import { cartTotals, opsToTxs, previewOp, qtyForBudget, qtyForProceeds, simulate, simulateExtras, simulateSteps, trailingDividend, type SimOp } from './simulation'

const TODAY = '2026-11-21'
const noFx = () => undefined
const op = (o: Partial<SimOp> & Pick<SimOp, 'type' | 'qty' | 'price'>): SimOp => ({ id: 'a', assetId: 'x', commissionEur: 0, ...o })

const eurPortfolio = (regime: string, extra: unknown[] = []): RawPortfolio => ({
  taxRegime: regime,
  assets: {
    x: { ticker: 'XXX', valuta: 'EUR', tipoAsset: 'stock', transactions: [{ id: 'b1', date: '2026-01-10', type: 'buy', qty: 10, price: 100 }, ...(extra as never[])] },
    y: { ticker: 'YYY', valuta: 'EUR', tipoAsset: 'stock', transactions: [{ id: 'b2', date: '2026-01-10', type: 'buy', qty: 10, price: 100 }] },
  },
})
const run = (p: RawPortfolio, ops: SimOp[]) => simulate({ portfolio: p, fx: noFx, latestFx: {}, ops, today: TODAY })

describe('simulatore', () => {
  it('un acquisto cambia il PMC (commissioni incluse) e non tocca le tasse', () => {
    const s = run(eurPortfolio('amministrato'), [op({ type: 'buy', qty: 10, price: 120, commissionEur: 10 })])
    expect(s.assets[0]!.before).toMatchObject({ qty: 10, pmcEur: 100 })
    expect(s.assets[0]!.after.qty).toBe(20)
    expect(s.assets[0]!.after.pmcEur).toBeCloseTo((1000 + 1200 + 10) / 20, 8)
    expect(s.taxEur).toBe(0)
    expect(s.gainEur).toBe(0)
    expect(s.cashEur).toBeCloseTo(-1210, 8)
  })

  it('una vendita in guadagno: plus, imposta al 26% e incasso netto', () => {
    const s = run(eurPortfolio('amministrato'), [op({ type: 'sell', qty: 4, price: 150, commissionEur: 5 })])
    expect(s.gainEur).toBeCloseTo(4 * 50 - 5, 8)
    expect(s.taxEur).toBeCloseTo((200 - 5) * 0.26, 8)
    expect(s.cashEur).toBeCloseTo(600 - 5 - s.taxEur, 8)
    expect(s.assets[0]!.after).toMatchObject({ qty: 6, pmcEur: 100 }) // la vendita non cambia il PMC
  })

  it('usa le minus del cassetto e dice quante ne restano', () => {
    const p = eurPortfolio('amministrato', [{ id: 'l', date: '2026-03-01', type: 'sell', qty: 5, price: 80 }]) // minus 100 €
    const s = run(p, [op({ assetId: 'y', type: 'sell', qty: 5, price: 140 })]) // plus 200 €
    expect(s.lossesBeforeEur).toBeCloseTo(100, 8)
    expect(s.lossesUsedEur).toBeCloseTo(100, 8)
    expect(s.lossesAfterEur).toBeCloseTo(0, 8)
    expect(s.taxEur).toBeCloseTo(100 * 0.26, 8)
  })

  it('una vendita in perdita non paga tasse e aumenta le minus disponibili', () => {
    const s = run(eurPortfolio('amministrato'), [op({ type: 'sell', qty: 10, price: 70 })])
    expect(s.gainEur).toBeCloseTo(-300, 8)
    expect(s.taxEur).toBe(0)
    expect(s.lossesAfterEur).toBeCloseTo(300, 8)
  })

  it('carrello: più operazioni insieme, in dichiarativo la minus di oggi abbassa l’imposta già maturata', () => {
    const p = eurPortfolio('dichiarativo', [{ id: 'g', date: '2026-02-01', type: 'sell', qty: 5, price: 140 }]) // plus 200 € già realizzata
    const before = run(p, [])
    expect(before.taxEur).toBe(0)
    const s = run(p, [op({ id: '1', assetId: 'y', type: 'sell', qty: 10, price: 80 })]) // minus 200 €
    expect(s.taxEur).toBeCloseTo(-200 * 0.26, 8) // risparmio d'imposta sulla plus dello stesso anno
  })

  it('segnala una vendita oltre la quantità posseduta', () => {
    const s = run(eurPortfolio('amministrato'), [op({ type: 'sell', qty: 50, price: 100 })])
    expect(s.issues.map(i => i.code)).toContain('vendita-oltre-quantita')
  })

  it('titolo in dollari: usa il cambio più recente per le operazioni simulate', () => {
    const p: RawPortfolio = {
      taxRegime: 'amministrato',
      assets: { u: { ticker: 'UUU', valuta: 'USD', transactions: [{ id: 'b', date: '2026-01-10', type: 'buy', qty: 10, price: 100 }] } },
    }
    const fx = (c: string, d: string) => (c === 'USD' && d === '2026-01-10' ? 1.25 : undefined) // costo 1000 USD = 800 €
    const s = simulate({ portfolio: p, fx, latestFx: { USD: 1.0 }, today: TODAY, ops: [op({ assetId: 'u', type: 'sell', qty: 10, price: 100 })] })
    expect(s.gainEur).toBeCloseTo(1000 - 800, 8) // incasso 1000 USD a 1,0
    expect(s.issues).toHaveLength(0)
  })

  it('ignora operazioni non valide e non modifica il portafoglio di partenza', () => {
    const p = eurPortfolio('amministrato')
    const snapshot = JSON.stringify(p)
    const s = run(p, [op({ assetId: 'nessuno', type: 'buy', qty: 1, price: 1 }), op({ type: 'buy', qty: 0, price: 1 })])
    expect(s.ops).toHaveLength(0)
    expect(JSON.stringify(p)).toBe(snapshot)
  })

  it('short: apertura e chiusura simulate', () => {
    const s = run(eurPortfolio('amministrato'), [
      op({ id: '1', type: 'short_sell', qty: 10, price: 100 }),
    ])
    expect(s.cashEur).toBeCloseTo(1000, 8)
  })
})

describe('registra il carrello come movimenti', () => {
  it('un movimento per operazione, con la data scelta e il prezzo da confermare', () => {
    let n = 0
    const txs = opsToTxs(
      [{ id: 'a', assetId: 'x', type: 'sell', qty: 5, price: 12.5, commissionEur: 2 }, { id: 'b', assetId: 'y', type: 'buy', qty: 1, price: 100, commissionEur: 0 }],
      '2026-11-23',
      () => `id${n++}`,
    )
    expect(txs).toEqual([
      { assetId: 'x', tx: { id: 'id0', date: '2026-11-23', type: 'sell', qty: 5, price: 12.5, commission: 2, commissionCurrency: 'EUR', source: 'simulatore', priceEstimated: true } },
      { assetId: 'y', tx: expect.objectContaining({ id: 'id1', type: 'buy', qty: 1 }) },
    ])
  })
})

describe('bollo/IVAFE e dividendi nel simulatore', () => {
  const sim = (before: number, after: number, currency = 'USD') => ({
    assets: [{ assetId: 'x', symbol: 'X', currency, before: { qty: before, pmcNative: 0, pmcEur: 0, costEur: 0 }, after: { qty: after, pmcNative: 0, pmcEur: 0, costEur: 0 } }],
  }) as never

  it('dividendi degli ultimi 12 mesi', () => {
    expect(trailingDividend([{ exDate: '2025-11-01', amount: 9 }, { exDate: '2026-03-01', amount: 0.5 }, { exDate: '2026-09-01', amount: 0.5 }], '2026-11-22')).toBe(1)
  })

  it('acquisto in dichiarativo: IVAFE in più e dividendi netti (26% sul lordo, ritenuta USA senza credito)', () => {
    const e = simulateExtras({ sim: sim(0, 100), regime: 'dichiarativo', prices: { x: 50 }, latestFx: { USD: 1.25 }, dividendPerShare: { x: 2 }, today: '2026-12-31' })
    expect(e.wealthKind).toBe('ivafe')
    expect(e.valueDeltaEur).toBeCloseTo(4000)
    expect(e.wealthYearDeltaEur).toBeCloseTo(8)
    expect(e.wealthThisYearDeltaEur).toBeCloseTo(8 / 365)
    expect(e.dividendsGrossDeltaEur).toBeCloseTo(160)
    expect(e.dividendsNetDeltaEur).toBeCloseTo(160 - 24 - 41.6)
  })

  it('vendita in amministrato: bollo e dividendi in meno; gli short non contano; senza prezzo si segnala', () => {
    const e = simulateExtras({ sim: sim(10, 4, 'EUR'), regime: 'amministrato', prices: { x: 100 }, latestFx: {}, dividendPerShare: { x: 3 }, today: '2026-01-01' })
    expect(e.wealthKind).toBe('bollo')
    expect(e.wealthYearDeltaEur).toBeCloseTo(-1.2)
    expect(e.dividendsNetDeltaEur).toBeCloseTo(-18 * 0.74)
    expect(simulateExtras({ sim: sim(0, -5, 'EUR'), regime: 'amministrato', prices: { x: 100 }, latestFx: {}, dividendPerShare: {}, today: '2026-01-01' }).valueDeltaEur).toBe(0)
    expect(simulateExtras({ sim: sim(0, 5), regime: 'amministrato', prices: {}, latestFx: {}, dividendPerShare: {}, today: '2026-01-01' }).missing).toEqual(['X'])
  })
})

describe('qtyForBudget', () => {
  it('azioni intere comprabili con il budget, commissioni comprese', () => {
    // 1.000 € con un titolo a 108 $ (1,08 $/€ → 100 €) e 5 € di commissioni: 9 azioni
    expect(qtyForBudget(1000, 108, 1.08, 5)).toBe(9)
    expect(qtyForBudget(1005, 100, 1, 5)).toBe(10)
  })
  it('budget, prezzo o cambio mancanti: zero', () => {
    expect(qtyForBudget(0, 100, 1, 0)).toBe(0)
    expect(qtyForBudget(1000, NaN, 1, 0)).toBe(0)
    expect(qtyForBudget(1000, 100, NaN, 0)).toBe(0)
    expect(qtyForBudget(3, 100, 1, 5)).toBe(0)
  })
})

describe('righe del carrello', () => {
  it('imposta, netto e PMC dopo ogni riga, con le minus usate nell’ordine del carrello', () => {
    const p = eurPortfolio('amministrato')
    const ops = [
      op({ id: '1', type: 'sell', qty: 5, price: 80 }), // minus 100
      op({ id: '2', type: 'sell', qty: 5, price: 140, commissionEur: 2 }), // plus 198, ne compensa 100
      op({ id: '3', assetId: 'y', type: 'buy', qty: 5, price: 120 }),
    ]
    const s = simulateSteps({ portfolio: p, fx: noFx, latestFx: {}, ops, today: TODAY })
    expect(s.get('1')!.taxEur).toBe(0)
    expect(s.get('1')!.netEur).toBeCloseTo(400, 8)
    expect(s.get('2')!.taxEur).toBeCloseTo(98 * 0.26, 8)
    expect(s.get('2')!.netEur).toBeCloseTo(700 - 2 - 98 * 0.26, 8)
    expect(s.get('3')!.after.qty).toBe(15)
    expect(s.get('3')!.after.pmcEur).toBeCloseTo((1000 + 600) / 15, 8)
    // in ordine inverso la minus arriva dopo: in amministrato non compensa la plus già fatta
    const rev = simulateSteps({ portfolio: p, fx: noFx, latestFx: {}, ops: [ops[1]!, ops[0]!], today: TODAY })
    expect(rev.get('2')!.taxEur).toBeCloseTo(198 * 0.26, 8)
    expect(rev.get('1')!.taxEur).toBe(0)
  })
})

describe('anteprima della finestra Simula', () => {
  const base = { fx: noFx, latestFx: {}, today: TODAY }

  it('acquisto: prima e dopo, spesa con commissioni', () => {
    const p = previewOp({ ...base, portfolio: eurPortfolio('amministrato'), cart: [], op: op({ id: 'n', type: 'buy', qty: 10, price: 120, commissionEur: 10 }) })!
    expect(p.before).toMatchObject({ qty: 10, pmcNative: 100, costEur: 1000 })
    expect(p.after.qty).toBe(20)
    expect(p.after.pmcNative).toBeCloseTo(2210 / 20, 8)
    expect(p.netEur).toBeCloseTo(-1210, 8)
    expect(p.taxEur).toBe(0)
    expect(p.issue).toBeNull()
  })

  it('vendita dopo il carrello: parte dalla posizione già simulata e conta solo la sua imposta', () => {
    const cart = [op({ id: 'c1', type: 'sell', qty: 4, price: 150 })]
    const p = previewOp({ ...base, portfolio: eurPortfolio('amministrato'), cart, op: op({ id: 'n', type: 'sell', qty: 2, price: 150, commissionEur: 2 }) })!
    expect(p.before.qty).toBe(6)
    expect(p.after.qty).toBe(4)
    expect(p.gainEur).toBeCloseTo(98, 8)
    expect(p.taxEur).toBeCloseTo(98 * 0.26, 8)
    expect(p.netEur).toBeCloseTo(300 - 2 - 98 * 0.26, 8)
  })

  it('vendita oltre la quantità: lo dice', () => {
    const p = previewOp({ ...base, portfolio: eurPortfolio('amministrato'), cart: [], op: op({ id: 'n', type: 'sell', qty: 50, price: 150 }) })
    expect(p?.issue).toBeTruthy()
  })

  it('totali del carrello: uscite, entrate nette, imposte e saldo', () => {
    const ops = [op({ id: 'v', type: 'sell', qty: 4, price: 150 }), op({ id: 'a', assetId: 'y', type: 'buy', qty: 1, price: 100, commissionEur: 1 })]
    const steps = simulateSteps({ ...base, portfolio: eurPortfolio('amministrato'), ops })
    const t = cartTotals(ops, steps)
    expect(t.spentEur).toBeCloseTo(101, 8)
    expect(t.taxEur).toBeCloseTo(52, 8)
    expect(t.receivedEur).toBeCloseTo(600 - 52, 8)
    expect(t.balanceEur).toBeCloseTo(600 - 52 - 101, 8)
  })
})

describe('qtyForProceeds', () => {
  it('azioni intere da vendere per incassare almeno la somma, commissioni comprese', () => {
    expect(qtyForProceeds(1000, 7.1, 1, 2)).toBe(142) // 141 × 7,10 = 1.001,10 non basta per 1.002
    expect(qtyForProceeds(1000, 100, 1, 0)).toBe(10)
    expect(qtyForProceeds(1000, 200, 1.1, 0)).toBe(6) // in dollari
    expect(qtyForProceeds(0, 100, 1, 0)).toBe(0)
  })
})
