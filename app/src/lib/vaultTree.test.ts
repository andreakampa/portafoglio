// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createKeyring } from './crypto'
import { getIn, openTree, relOf, sealTree, setIn, split, unitAbove } from './vaultTree'

const UID = 'u1'
const key = async () => (await createKeyring('p', 1000)).dataKey
const state = {
  activePortfolioId: 'p1',
  portfolios: {
    p1: { name: 'IBKR', regime: 'dichiarativo', assets: { aapl: { ticker: 'AAPL', transactions: [{ q: 10, p: 150 }] } } },
    p2: { name: 'Fineco', assets: {} },
  },
}

describe('unità', () => {
  it('un portafoglio intero, il resto al secondo livello', () => {
    expect(unitAbove(relOf('users/u1/portfolio_state/portfolios/p1/assets/aapl', UID)!)).toEqual(['portfolio_state', 'portfolios', 'p1'])
    expect(unitAbove(relOf('users/u1/settings/pacPlans/x', UID)!)).toEqual(['settings', 'pacPlans'])
    expect(unitAbove(relOf('users/u1/settings/maxLeverage', UID)!)).toBeNull()
  })
  it('watchlist, notifiche e busta della chiave restano fuori', () => {
    expect(unitAbove(relOf('users/u1/settings/watchlist/aapl/fired', UID)!)).toBeNull()
    expect(relOf('members/u1', UID)).toBeNull()
    expect(relOf('users/u2/settings', UID)).toBeNull()
  })
})

describe('cifrare e decifrare l\'albero', () => {
  it('portafogli: nomi, titoli e movimenti non si vedono', async () => {
    const k = await key()
    const sealed = await sealTree(k, UID, 'users/u1/portfolio_state', state)
    const text = JSON.stringify(sealed)
    for (const s of ['IBKR', 'Fineco', 'AAPL', 'aapl', '150', 'dichiarativo']) expect(text).not.toContain(s)
    expect(Object.keys((sealed as { portfolios: object }).portfolios)).toEqual(['p1', 'p2'])
    expect(await openTree(k, 'users/u1/portfolio_state', sealed)).toEqual(state)
  })
  it('impostazioni: watchlist e notifiche in chiaro, il resto cifrato', async () => {
    const k = await key()
    const settings = { watchlist: { aapl: { symbol: 'AAPL', above: 200 } }, push: { a: { endpoint: 'https://x' } }, maxLeverage: 1.5, simCart: [{ s: 'MSFT' }] }
    const sealed = (await sealTree(k, UID, 'users/u1/settings', settings)) as Record<string, unknown>
    expect(sealed.watchlist).toEqual(settings.watchlist)
    expect(sealed.push).toEqual(settings.push)
    expect(JSON.stringify(sealed.simCart)).not.toContain('MSFT')
    expect(await openTree(k, 'users/u1/settings', sealed)).toEqual(settings)
  })
  it('scrivendo l\'intero utente la busta della chiave non si tocca', async () => {
    const k = await key()
    const crypto = { v: 1, password: { ct: 'x' } }
    const sealed = (await sealTree(k, UID, 'users/u1', { crypto, notes: { n1: { text: 'segreto' } } })) as Record<string, unknown>
    expect(sealed.crypto).toEqual(crypto)
    expect(JSON.stringify(sealed.notes)).not.toContain('segreto')
  })
  it('i dati di altri percorsi non si cifrano', async () => {
    const k = await key()
    expect(await sealTree(k, UID, 'members/u1', { email: 'a@b.it' })).toEqual({ email: 'a@b.it' })
  })
  it('un\'unità spostata in un altro portafoglio non si apre', async () => {
    const k = await key()
    const sealed = (await sealTree(k, UID, 'users/u1/portfolio_state', state)) as { portfolios: Record<string, unknown> }
    await expect(openTree(k, 'users/u1/portfolio_state/portfolios/p2', sealed.portfolios.p1)).rejects.toThrow()
  })
  it('serverTimestamp dentro un dato cifrato diventa l\'ora attuale', async () => {
    const k = await key()
    const sealed = await sealTree(k, UID, 'users/u1/settings/x', { at: { '.sv': 'timestamp' } })
    const v = (await openTree(k, 'users/u1/settings/x', sealed)) as { at: number }
    expect(typeof v.at).toBe('number')
  })
})

describe('sotto-percorsi', () => {
  it('leggere e cambiare dentro un\'unità', () => {
    const p1 = state.portfolios.p1
    expect(getIn(p1, split('assets/aapl/ticker'))).toBe('AAPL')
    expect(getIn(p1, split('assets/msft'))).toBeNull()
    const next = setIn(p1, split('assets/msft'), { ticker: 'MSFT' }) as typeof p1 & { assets: Record<string, unknown> }
    expect(Object.keys(next.assets)).toEqual(['aapl', 'msft'])
    expect(p1.assets).not.toHaveProperty('msft')
  })
  it('togliere l\'ultimo figlio toglie anche il padre vuoto, come Firebase', () => {
    expect(setIn({ a: { b: 1 } }, ['a', 'b'], null)).toBeNull()
    expect(setIn({ a: { b: 1 }, c: 2 }, ['a', 'b'], null)).toEqual({ c: 2 })
  })
})
