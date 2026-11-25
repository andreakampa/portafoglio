import { describe, expect, it } from 'vitest'
import { computePortfolio } from './engine/portfolio'
import type { RawTx } from './engine/types'
import { buildExercise, confirmInList, optionKind, optionStrike, pacQty, pacRate } from './txEdit'
import {
  addToList, assetKey, deleteAssetBlock, buildAsset, buildTransferPair, buildTx, findSameAsset, findTransfer, formFromTx, heldQty, removeFromList, replaceInList, transferWrites,
  validateNewAsset, validateTransfer, validateTx, type TxForm,
} from './txEdit'

const TODAY = '2026-11-21'
const form = (o: Partial<TxForm> = {}): TxForm => ({ type: 'buy', date: '2026-11-10', qty: '10', price: '12,5', commission: '1,2', commissionCurrency: 'EUR', pac: false, ...o })
let n = 0
const id = () => `id${++n}`

describe('validazione del movimento', () => {
  it('accetta un movimento corretto, con la virgola decimale', () => {
    expect(validateTx(form(), TODAY)).toBeNull()
  })
  it.each([
    [{ date: '' }, 'data'],
    [{ date: '2026-12-01' }, 'futuro'],
    [{ qty: '0' }, 'quantità'],
    [{ qty: 'abc' }, 'quantità'],
    [{ price: '-1' }, 'prezzo'],
    [{ price: '' }, 'prezzo'],
    [{ commission: '-3' }, 'commissioni'],
  ])('rifiuta %j', (o, word) => {
    expect(validateTx(form(o), TODAY)).toMatch(new RegExp(word, 'i'))
  })
  it('il prezzo zero è ammesso (es. azioni regalo)', () => {
    expect(validateTx(form({ price: '0' }), TODAY)).toBeNull()
  })
})

describe('costruzione del movimento', () => {
  it('numeri, id e valuta della commissione', () => {
    expect(buildTx(form({ commissionCurrency: 'usd' }), id)).toMatchObject({ type: 'buy', qty: 10, price: 12.5, commission: 1.2, commissionCurrency: 'USD', id: expect.any(String) })
  })
  it('PAC solo sugli acquisti', () => {
    expect(buildTx(form({ pac: true }), id).source).toBe('pac')
    expect(buildTx(form({ pac: true, type: 'sell' }), id).source).toBeUndefined()
  })
  it('in modifica conserva id, id IBKR e margine; cambiando data o prezzo toglie il cambio vecchio', () => {
    const prev: RawTx = { id: 'k', date: '2026-11-10', type: 'buy', qty: 10, price: 12.5, externalId: '1@x', source: 'ibkr', marginAmount: 50, exchangeRate: 1.1 }
    const same = buildTx(form({ qty: '11' }), id, prev)
    expect(same).toMatchObject({ id: 'k', externalId: '1@x', marginAmount: 50, qty: 11, exchangeRate: 1.1 })
    const moved = buildTx(form({ date: '2026-11-12' }), id, prev)
    expect(moved.exchangeRate).toBeUndefined()
    expect(moved.externalId).toBe('1@x')
  })
  it('togliere la spunta PAC toglie il segno', () => {
    expect(buildTx(form({ pac: false }), id, { date: '2026-11-10', type: 'buy', qty: 1, price: 1, source: 'pac' }).source).toBeUndefined()
  })
  it('la maschera si riempie dal movimento', () => {
    expect(formFromTx({ date: '2026-01-02', type: 'sell', qty: 3, price: 4.5, commission: 0.5, commissionCurrency: 'usd' }, 'USD')).toMatchObject({ type: 'sell', qty: '3', price: '4.5', commission: '0.5', commissionCurrency: 'USD', pac: false })
  })
})

describe('elenco dei movimenti', () => {
  const a: RawTx = { id: 'a', date: '2026-01-01', type: 'buy', qty: 1, price: 1 }
  const b: RawTx = { id: 'b', date: '2026-03-01', type: 'sell', qty: 1, price: 2 }

  it('aggiunge in ordine di data senza toccare l\'originale', () => {
    const list = [a, b]
    const out = addToList(list, { id: 'c', date: '2026-02-01', type: 'buy', qty: 1, price: 1 })
    expect(out.map(t => t.id)).toEqual(['a', 'c', 'b'])
    expect(list).toHaveLength(2)
    expect(addToList(undefined, a)).toEqual([a])
  })
  it('sostituisce e rimette in ordine', () => {
    const out = replaceInList([a, b], { id: 'a', index: 0, date: a.date, type: 'buy' }, { ...a, date: '2026-05-01' })!
    expect(out.map(t => t.id)).toEqual(['b', 'a'])
  })
  it('movimento senza id: si ritrova per posizione solo se è lo stesso', () => {
    const old: RawTx = { date: '2026-01-01', type: 'buy', qty: 1, price: 1 }
    expect(removeFromList([old], { index: 0, date: '2026-01-01', type: 'buy' })).toEqual([])
    expect(removeFromList([old], { index: 0, date: '2026-02-02', type: 'buy' })).toBeNull()
    expect(removeFromList([old], { index: 3, date: '2026-01-01', type: 'buy' })).toBeNull()
  })
  it('movimento sparito nel frattempo: nessuna modifica', () => {
    expect(removeFromList([a], { id: 'zzz', index: 0, date: a.date, type: 'buy' })).toBeNull()
    expect(replaceInList([a], { id: 'zzz', index: 0, date: a.date, type: 'buy' }, a)).toBeNull()
  })
  it('un movimento inserito con la maschera entra nel calcolo come gli altri', () => {
    const tx = buildTx(form({ qty: '10', price: '10', commission: '', commissionCurrency: 'EUR' }), id)
    const r = computePortfolio({ assets: { x: { ticker: 'X', valuta: 'EUR', transactions: addToList([], tx) } } }, () => undefined)
    expect(r.positions.x!.qty).toBe(10)
    expect(r.positions.x!.pmcEur).toBe(10)
  })
})

describe('titolo nuovo', () => {
  it('chiede ticker e valuta di tre lettere', () => {
    expect(validateNewAsset({ ticker: '', nome: '', valuta: 'EUR', tipoAsset: 'stock', isin: '' })).toMatch(/ticker/i)
    expect(validateNewAsset({ ticker: 'X', nome: '', valuta: 'E', tipoAsset: 'stock', isin: '' })).toMatch(/valuta/i)
    expect(validateNewAsset({ ticker: 'X', nome: '', valuta: 'eur', tipoAsset: 'stock', isin: '' })).toBeNull()
  })
  it('chiave senza caratteri vietati da Firebase e titolo in maiuscolo', () => {
    expect(assetKey('race.mi')).toBe('RACE_MI')
    expect(buildAsset({ ticker: ' race.mi ', nome: '', valuta: 'eur', tipoAsset: 'stock', isin: 'it001' })).toMatchObject({ ticker: 'RACE.MI', nome: 'RACE.MI', valuta: 'EUR', isin: 'IT001', transactions: [] })
  })
})

describe('trasferimento', () => {
  it('controlla quantità e data', () => {
    expect(validateTransfer({ date: TODAY, qty: '5' }, 4, TODAY)).toMatch(/solo 4/)
    expect(validateTransfer({ date: TODAY, qty: '' }, 4, TODAY)).toMatch(/quantità/)
    expect(validateTransfer({ date: '2027-01-01', qty: '1' }, 4, TODAY)).toMatch(/futuro/)
    expect(validateTransfer({ date: TODAY, qty: '4' }, 4, TODAY)).toBeNull()
  })
  it('crea uscita e entrata collegate dallo stesso transferId', () => {
    const p = buildTransferPair({ date: TODAY, qty: '3' }, 150.5, 'P1', 'P2', id)
    expect(p.out).toMatchObject({ type: 'transfer', qty: 3, price: 150.5, destPortfolioId: 'P2' })
    expect(p.in).toMatchObject({ type: 'transfer', qty: 3, price: 150.5, sourcePortfolioId: 'P1' })
    expect(p.out.transferId).toBeTruthy()
    expect(p.out.transferId).toBe(p.in.transferId)
    expect(p.out.id).not.toBe(p.in.id)
  })
  it('ritrova lo stesso titolo nella destinazione per ISIN o ticker', () => {
    const dest = { a1: { ticker: 'MSFT', isin: 'US1' }, a2: { nome: 'RACE.MI' } }
    expect(findSameAsset(dest, { ticker: 'XXX', isin: 'us1' })).toBe('a1')
    expect(findSameAsset(dest, { ticker: 'race.mi' })).toBe('a2')
    expect(findSameAsset(dest, { ticker: 'NVDA' })).toBeUndefined()
    expect(findSameAsset(undefined, { ticker: 'NVDA' })).toBeUndefined()
  })
})

describe('modifica ed eliminazione dei trasferimenti', () => {
  const out: RawTx = { id: 'o', date: '2026-05-26', type: 'transfer', qty: 10, price: 100, transferId: 'T1', destPortfolioId: 'B' }
  const inn: RawTx = { id: 'i', date: '2026-05-26', type: 'transfer', qty: 10, price: 100, transferId: 'T1', sourcePortfolioId: 'A' }
  const portfolios = () => ({
    A: { assets: { x: { ticker: 'RACE.MI', transactions: [{ id: 'b', date: '2025-01-02', type: 'buy', qty: 18, price: 90 }, out] } } },
    B: { assets: { y: { ticker: 'RACE.MI', transactions: [inn, { id: 's', date: '2026-07-01', type: 'sell', qty: 4, price: 120 }] } } },
  })

  it('trova le due metà in portafogli diversi', () => {
    const p = findTransfer(portfolios(), 'T1')
    expect(p.out).toMatchObject({ pid: 'A', aid: 'x', index: 1 })
    expect(p.in).toMatchObject({ pid: 'B', aid: 'y', index: 0 })
  })

  it('corregge data e quantità di entrambe le metà, il resto non cambia', () => {
    const ps = portfolios()
    const w = transferWrites(ps, findTransfer(ps, 'T1'), { form: { date: '2026-06-01', qty: '12' } })
    expect(Object.keys(w)).toEqual(['A/assets/x/transactions', 'B/assets/y/transactions'])
    expect(w['A/assets/x/transactions']![1]).toMatchObject({ id: 'o', date: '2026-06-01', qty: 12, price: 100, transferId: 'T1', destPortfolioId: 'B' })
    expect(w['B/assets/y/transactions']![0]).toMatchObject({ id: 'i', date: '2026-06-01', qty: 12, sourcePortfolioId: 'A' })
    expect(w['B/assets/y/transactions']![1]!.id).toBe('s')
  })

  it('elimina entrambe le metà', () => {
    const ps = portfolios()
    const w = transferWrites(ps, findTransfer(ps, 'T1'), { remove: true })
    expect(w['A/assets/x/transactions']!.map(t => t.id)).toEqual(['b'])
    expect(w['B/assets/y/transactions']!.map(t => t.id)).toEqual(['s'])
  })

  it('quantità disponibile, escluso il trasferimento stesso', () => {
    const ps = portfolios()
    expect(heldQty(ps.A.assets.x.transactions as RawTx[], out)).toBe(18)
    expect(heldQty(ps.B.assets.y.transactions as RawTx[])).toBe(6)
  })

  it('se una metà è sparita nel frattempo, si ferma', () => {
    const ps = portfolios()
    const pair = findTransfer(ps, 'T1')
    ps.A.assets.x.transactions = [ps.A.assets.x.transactions[0]!]
    expect(() => transferWrites(ps, pair, { remove: true })).toThrow(/cambiato/)
  })
})

describe('esercizio o assegnazione inseriti a mano', () => {
  it('riconosce call/put e strike dal ticker', () => {
    expect(optionKind('BMEA280121C00001500')).toBe('call')
    expect(optionKind('SPY261218P00450000')).toBe('put')
    expect(optionStrike('BMEA280121C00001500')).toBe(1.5)
    expect(optionKind('NVDA')).toBeNull()
  })
  it('call comprata → acquisto; put venduta → acquisto; put comprata e call venduta → vendita', () => {
    let n = 0
    const id = () => String(n++)
    const f = { date: '2028-01-21', qty: '100', strike: '1,5' }
    const a = buildExercise('call', 100, f, id)
    expect(a.option).toMatchObject({ type: 'exercise', qty: 100, price: 0 })
    expect(a.stock).toMatchObject({ type: 'buy', qty: 100, price: 1.5 })
    expect(a.stock.exerciseId).toBe(a.option.exerciseId)
    expect(buildExercise('put', -100, f, id).stock.type).toBe('buy')
    expect(buildExercise('put', 100, f, id).stock.type).toBe('sell')
    expect(buildExercise('call', -100, f, id).stock.type).toBe('sell')
  })
})

describe('deleteAssetBlock', () => {
  it('si può eliminare un titolo senza trasferimenti', () => {
    expect(deleteAssetBlock({ transactions: [{ type: 'buy' }, { type: 'sell' }] })).toBeNull()
    expect(deleteAssetBlock(undefined)).toBeNull()
  })
  it('bloccato se ha un trasferimento (uscita o entrata)', () => {
    expect(deleteAssetBlock({ transactions: [{ type: 'buy' }, { type: 'transfer' }] })).toMatch(/trasferimenti/)
    expect(deleteAssetBlock({ transactions: [{ type: 'buy', transferId: 'x' }] })).toMatch(/trasferimenti/)
  })
})

describe('conferma delle rate stimate', () => {
  const list: RawTx[] = [
    { id: 'a', date: '2026-11-02', type: 'buy', qty: 11.443, price: 4.37, source: 'pac', priceEstimated: true },
    { id: 'b', date: '2026-11-16', type: 'buy', qty: 11.3955, price: 4.39, source: 'pac', priceEstimated: true },
  ]
  it('toglie solo il segno, lasciando quantità e prezzo', () => {
    const out = confirmInList(list, [{ id: 'a', index: 0, date: '2026-11-02', type: 'buy' }])!
    expect(out[0]).toEqual({ id: 'a', date: '2026-11-02', type: 'buy', qty: 11.443, price: 4.37, source: 'pac' })
    expect(out[1]?.priceEstimated).toBe(true)
    expect(list[0]?.priceEstimated).toBe(true)
  })
  it('null se un movimento non c\'è più', () => {
    expect(confirmInList(list, [{ id: 'zz', index: 0, date: '2026-11-02', type: 'buy' }])).toBeNull()
  })
})

describe('quantità della rata PAC dal prezzo', () => {
  it('in euro: importo ÷ prezzo, 6 decimali', () => {
    expect(pacQty('50', '4,3812', pacRate('EUR'))).toBe(11.412398)
  })
  it('non in euro: il cambio si ricava dalla rata com\'era', () => {
    const rate = pacRate('USD', { date: '2026-11-02', type: 'buy', qty: 0.5, price: 116, importoPac: 50 })
    expect(rate).toBeCloseTo(1.16)
    expect(pacQty('50', '120', rate)).toBe(0.483333)
    expect(pacRate('USD', { date: '2026-11-02', type: 'buy', qty: 1, price: 1 })).toBeNull()
  })
  it('niente quantità senza importo o prezzo validi', () => {
    expect(pacQty('', '4', 1)).toBeNull()
    expect(pacQty('50', '0', 1)).toBeNull()
    expect(pacQty('50', '4', null)).toBeNull()
  })
  it('l\'importo finisce nel movimento e torna nella maschera', () => {
    const tx = buildTx(form({ pac: true, pacAmount: '25' }), id)
    expect(tx.importoPac).toBe(25)
    expect(formFromTx(tx, 'EUR').pacAmount).toBe('25')
  })
  it('salvare la maschera toglie il segno da confermare', () => {
    expect(buildTx(form(), id, { date: '2026-11-10', type: 'buy', qty: 1, price: 1, priceEstimated: true }).priceEstimated).toBeUndefined()
  })
})
