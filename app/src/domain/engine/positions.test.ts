import { describe, expect, it } from 'vitest'
import { computePosition } from './positions.ts'
import type { FxLookup, RawAsset } from './types.ts'

const noFx: FxLookup = () => undefined
const fxTable =
  (t: Record<string, number>): FxLookup =>
  (cur, date) =>
    t[`${cur}:${date}`]

const asset = (valuta: string, transactions: RawAsset['transactions']): RawAsset => ({ valuta, transactions })

describe('posizione long in EUR', () => {
  const a = asset('EUR', [
    { id: 'b1', date: '2026-01-10', type: 'buy', qty: 10, price: 100, commission: 5 },
    { id: 'b2', date: '2026-02-10', type: 'buy', qty: 10, price: 120, commission: 5 },
    { id: 's1', date: '2026-03-10', type: 'sell', qty: 5, price: 130, commission: 5 },
  ])

  it('costo medio ponderato (amministrato)', () => {
    const p = computePosition(a, 'average', noFx)
    // costo totale 1005 + 1205 = 2210 su 20 → 110,50; vendo 5: costo 552,50, incasso 650 − 5 = 645
    expect(p.realized).toHaveLength(1)
    expect(p.realized[0]!.costEur).toBeCloseTo(552.5, 8)
    expect(p.realized[0]!.gainEur).toBeCloseTo(92.5, 8)
    expect(p.qty).toBeCloseTo(15, 8)
    expect(p.pmcEur).toBeCloseTo(110.5, 8)
    expect(p.commissionsEur).toBeCloseTo(15, 8)
    expect(p.issues).toEqual([])
  })

  it('LIFO (dichiarativo): si vende prima il lotto più recente', () => {
    const p = computePosition(a, 'lifo', noFx)
    // lotto di febbraio: 1205 / 10 = 120,50 → costo 602,50
    expect(p.realized[0]!.gainEur).toBeCloseTo(42.5, 8)
    expect(p.costEur).toBeCloseTo(2210 - 602.5, 8)
    expect(p.pmcEur).toBeCloseTo((2210 - 602.5) / 15, 8)
  })

  it('vendita a lotti specifici: usa il lotto indicato, anche in amministrato', () => {
    const p = computePosition(
      asset('EUR', [
        { date: '2026-01-01', type: 'buy', qty: 10, price: 10 },
        { date: '2026-02-01', type: 'buy', qty: 10, price: 20 },
        { date: '2026-03-01', type: 'sell', qty: 5, price: 30, lotAllocation: [{ lotId: '2026-01-01#0', qty: 5 }] },
      ]),
      'average',
      noFx,
    )
    expect(p.realized[0]!.gainEur).toBeCloseTo(150 - 50, 8)
    expect(p.costEur).toBeCloseTo(50 + 200, 8)
  })
})

describe('titoli in valuta estera', () => {
  it('il risultato fiscale in EUR include l’effetto cambio', () => {
    const p = computePosition(
      asset('USD', [
        { date: '2026-01-10', type: 'buy', qty: 10, price: 100, commission: 1, exchangeRate: 1.25 },
        { date: '2026-06-10', type: 'sell', qty: 10, price: 110, commission: 1, exchangeRate: 1.1 },
      ]),
      'average',
      noFx,
    )
    // acquisto: 1000 USD / 1,25 = 800 € + 1 € di commissione = 801 €
    // vendita: 1100 USD / 1,1 = 1000 € − 1 € = 999 € → plus 198 € (in dollari: +97,65)
    const e = p.realized[0]!
    expect(e.costEur).toBeCloseTo(801, 8)
    expect(e.proceedsEur).toBeCloseTo(999, 8)
    expect(e.gainEur).toBeCloseTo(198, 8)
    expect(e.gainNative).toBeCloseTo(1100 - 1.1 - (1000 + 1.25), 8)
    expect(p.qty).toBe(0)
  })

  it('senza cambio salvato usa il cambio storico della data, mai quello di oggi', () => {
    const p = computePosition(
      asset('USD', [{ date: '2026-01-10', type: 'buy', qty: 1, price: 125 }]),
      'average',
      fxTable({ 'USD:2026-01-10': 1.25 }),
    )
    expect(p.costEur).toBeCloseTo(100, 8)
    expect(p.issues).toEqual([])
  })

  it('segnala il cambio mancante invece di inventarlo', () => {
    const p = computePosition(asset('CAD', [{ id: 'x', date: '2026-01-10', type: 'buy', qty: 1, price: 10 }]), 'average', noFx)
    expect(p.issues).toEqual([expect.objectContaining({ code: 'cambio-mancante', txId: 'x' })])
    expect(Number.isNaN(p.costEur)).toBe(true)
  })

  it('il cambio salvato vale solo per la valuta del titolo (CAD non usa il cambio USD)', () => {
    const p = computePosition(
      asset('CAD', [{ date: '2026-01-10', type: 'buy', qty: 10, price: 16, exchangeRate: 1.6 }]),
      'average',
      fxTable({ 'USD:2026-01-10': 1.1 }),
    )
    expect(p.costEur).toBeCloseTo(100, 8)
  })

  it('commissione in USD su un titolo in EUR', () => {
    const p = computePosition(
      asset('EUR', [{ date: '2026-01-10', type: 'buy', qty: 1, price: 100, commission: 2, commissionCurrency: 'USD' }]),
      'average',
      fxTable({ 'USD:2026-01-10': 1.25 }),
    )
    expect(p.costEur).toBeCloseTo(101.6, 8)
  })
})

describe('trasferimenti tra portafogli', () => {
  it('in uscita: esce al costo, senza plus né minus', () => {
    const p = computePosition(
      asset('EUR', [
        { date: '2026-01-10', type: 'buy', qty: 10, price: 100 },
        { date: '2026-02-10', type: 'transfer', qty: 4, price: 100, destPortfolioId: 'altro' },
      ]),
      'average',
      noFx,
    )
    expect(p.realized).toEqual([])
    expect(p.qty).toBeCloseTo(6, 8)
    expect(p.costEur).toBeCloseTo(600, 8)
  })

  it('in entrata: arriva al prezzo di carico indicato', () => {
    const p = computePosition(
      asset('EUR', [{ date: '2026-02-10', type: 'transfer', qty: 4, price: 100, sourcePortfolioId: 'altro', commission: 3 }]),
      'average',
      noFx,
    )
    expect(p.costEur).toBeCloseTo(400, 8)
  })
})

describe('short', () => {
  const a = asset('USD', [
    { id: 'ss', date: '2026-01-10', type: 'short_sell', qty: 10, price: 50, commission: 1, commissionCurrency: 'USD', exchangeRate: 1.25 },
    { id: 'bc', date: '2026-02-10', type: 'buy_to_cover', qty: 4, price: 40, commission: 1, commissionCurrency: 'USD', exchangeRate: 1.25 },
  ])

  it('la ricopertura realizza incasso − costo di riacquisto', () => {
    const p = computePosition(a, 'lifo', noFx)
    // incasso: (500 − 1) USD = 399,20 €; per 4 su 10 → 159,68 €
    // riacquisto: (160 + 1) USD = 128,80 € → plus 30,88 €
    const e = p.realized[0]!
    expect(e.side).toBe('short')
    expect(e.gainEur).toBeCloseTo(30.88, 8)
    expect(e.gainNative).toBeCloseTo(499 * 0.4 - 161, 8)
  })

  it('posizione aperta negativa, senza toccare il costo dei long', () => {
    const p = computePosition(a, 'lifo', noFx)
    expect(p.isShort).toBe(true)
    expect(p.qty).toBeCloseTo(-6, 8)
    expect(p.costNative).toBeCloseTo(499 * 0.6, 8)
  })

  it('se il prezzo sale, la ricopertura è una minus', () => {
    const p = computePosition(
      asset('EUR', [
        { date: '2026-01-10', type: 'short_sell', qty: 1, price: 100 },
        { date: '2026-02-10', type: 'buy_to_cover', qty: 1, price: 120 },
      ]),
      'average',
      noFx,
    )
    expect(p.realized[0]!.gainEur).toBeCloseTo(-20, 8)
    expect(p.qty).toBe(0)
  })
})

describe('dati non coerenti', () => {
  it('vendita oltre la quantità posseduta: segnalata e calcolata solo sul posseduto', () => {
    const p = computePosition(
      asset('EUR', [
        { date: '2026-01-10', type: 'buy', qty: 2, price: 10 },
        { id: 's', date: '2026-02-10', type: 'sell', qty: 3, price: 15 },
      ]),
      'average',
      noFx,
    )
    expect(p.issues).toEqual([expect.objectContaining({ code: 'vendita-oltre-quantita', txId: 's' })])
    expect(p.realized[0]!.qty).toBeCloseTo(2, 8)
    expect(p.realized[0]!.gainEur).toBeCloseTo(10, 8)
  })

  it('ordina i movimenti per data anche se salvati in disordine', () => {
    const p = computePosition(
      asset('EUR', [
        { date: '2026-02-10', type: 'sell', qty: 1, price: 15 },
        { date: '2026-01-10', type: 'buy', qty: 1, price: 10 },
      ]),
      'average',
      noFx,
    )
    expect(p.realized[0]!.gainEur).toBeCloseTo(5, 8)
    expect(p.issues).toEqual([])
  })
})

describe('FIFO (solo per confronto con i broker)', () => {
  it('vende prima il lotto più vecchio', () => {
    const p = computePosition(
      asset('EUR', [
        { date: '2026-01-10', type: 'buy', qty: 10, price: 100 },
        { date: '2026-02-10', type: 'buy', qty: 10, price: 120 },
        { date: '2026-03-10', type: 'sell', qty: 15, price: 130 },
      ]),
      'fifo',
      noFx,
    )
    // 10 a 100 + 5 a 120 = 1600 → 1950 − 1600 = 350
    expect(p.realized[0]!.gainEur).toBeCloseTo(350, 8)
    expect(p.costEur).toBeCloseTo(600, 8)
  })
})

describe('fotografie dopo ogni movimento (storico del titolo)', () => {
  it('PMC e quantità dopo ogni movimento, in ordine di data, con l’indice nei dati', () => {
    // Dati fuori ordine: lo storico segue la data, l'indice punta al movimento originale.
    const a = asset('USD', [
      { id: 'b2', date: '2026-02-10', type: 'buy', qty: 10, price: 20, commission: 0 },
      { id: 'b1', date: '2026-01-10', type: 'buy', qty: 10, price: 10, commission: 0 },
      { id: 's1', date: '2026-03-10', type: 'sell', qty: 5, price: 30, commission: 0 },
    ])
    const fx = fxTable({ 'USD:2026-01-10': 1.25, 'USD:2026-02-10': 1, 'USD:2026-03-10': 1.1 })
    const p = computePosition(a, 'average', fx)
    expect(p.steps!.map(s => s.index)).toEqual([1, 0, 2])
    expect(p.steps!.map(s => s.qty)).toEqual([10, 20, 15])
    expect(p.steps![0]!.pmcNative).toBeCloseTo(10)
    expect(p.steps![0]!.pmcEur).toBeCloseTo(8)
    expect(p.steps![1]!.pmcNative).toBeCloseTo(15)
    expect(p.steps![1]!.pmcEur).toBeCloseTo(14) // (80 + 200) / 20
    expect(p.steps![2]!.pmcNative).toBeCloseTo(15)
    expect(p.steps![2]!.rate).toBe(1.1)
    // L'ultima fotografia coincide con la posizione finale.
    expect(p.steps![2]!.pmcEur).toBeCloseTo(p.pmcEur)
  })
})
