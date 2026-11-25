import { describe, expect, it } from 'vitest'
import { FUTURES_TILES, FX_CRYPTO_TILES, INDEX_TILES, dayChange, formatTilePrice, openingSentiment, usMarketPhase, vixStatus } from './market.ts'

describe('VIX', () => {
  it('calmo sotto 20, nervoso fino a 25, paura (giallo) da 25 a 30, paura estrema (rosso) da 30', () => {
    expect(vixStatus(15)).toEqual({ key: 'good', label: 'calmo' })
    expect(vixStatus(22)).toEqual({ key: 'warning', label: 'nervoso' })
    expect(vixStatus(25)).toEqual({ key: 'warning', label: 'paura' })
    expect(vixStatus(29.9)).toEqual({ key: 'warning', label: 'paura' })
    expect(vixStatus(30)).toEqual({ key: 'critical', label: 'paura estrema' })
  })
})

describe('pannello Mercati', () => {
  it('ha gli indici e poi cambio euro/dollaro, Bitcoin ed Ethereum', () => {
    expect(INDEX_TILES.map(t => t.symbol)).toEqual(['^NDX', '^GSPC', '^VIX', '^VXN'])
    expect(FX_CRYPTO_TILES.map(t => t.symbol)).toEqual(['EURUSD=X', 'BTC-USD', 'ETH-USD'])
  })

  it('formatta i prezzi in italiano con i decimali del riquadro', () => {
    expect(formatTilePrice(1.05234, 4)).toBe('1,0523')
    expect(formatTilePrice(87432.7, 0)).toBe('87.433')
    expect(formatTilePrice(3012.456, 2)).toBe('3012,46') // come gli indici: separatore delle migliaia da 5 cifre
  })

  it('variazione del giorno sulla chiusura precedente', () => {
    expect(dayChange(110, 100)).toBeCloseTo(10)
    expect(dayChange(90, 100)).toBeCloseTo(-10)
    expect(dayChange(90, null)).toBeNull()
  })
})

describe('futures e fasi della borsa USA', () => {
  it('ci sono i futures principali', () => {
    expect(FUTURES_TILES.map(t => t.symbol)).toEqual(['ES=F', 'NQ=F', 'YM=F', 'RTY=F'])
    expect(INDEX_TILES.find(t => t.symbol === '^NDX')?.future).toBe('NQ=F')
  })

  it('fase secondo l\'ora di New York (novembre: UTC-5)', () => {
    expect(usMarketPhase(new Date('2026-11-25T13:00:00Z'))).toBe('pre') // mercoledì 08:00 NY
    expect(usMarketPhase(new Date('2026-11-25T15:00:00Z'))).toBe('regular') // 10:00
    expect(usMarketPhase(new Date('2026-11-25T22:00:00Z'))).toBe('closed') // 17:00, futures ancora su ieri
    expect(usMarketPhase(new Date('2026-11-26T00:00:00Z'))).toBe('post') // 19:00
    expect(usMarketPhase(new Date('2026-11-27T23:30:00Z'))).toBe('closed') // venerdì sera
    expect(usMarketPhase(new Date('2026-11-28T15:00:00Z'))).toBe('closed') // sabato
    expect(usMarketPhase(new Date('2026-11-29T23:30:00Z'))).toBe('pre') // domenica 18:30, riaprono i futures
  })

  it('sentiment di apertura dalla media dei futures', () => {
    expect(openingSentiment([0.5, 0.4, null])?.key).toBe('pos')
    expect(openingSentiment([-0.6, -0.2])?.key).toBe('neg')
    expect(openingSentiment([0.1, -0.1])?.key).toBe('flat')
    expect(openingSentiment([null])).toBeNull()
  })
})
