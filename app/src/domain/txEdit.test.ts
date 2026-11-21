import { describe, expect, it } from 'vitest'
import { computePortfolio } from './engine/portfolio'
import type { RawTx } from './engine/types'
import {
  addToList, assetKey, buildAsset, buildTransferPair, buildTx, findSameAsset, formFromTx, removeFromList, replaceInList,
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
