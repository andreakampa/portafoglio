import { describe, expect, it } from 'vitest'
import { FX_CRYPTO_TILES, INDEX_TILES, dayChange, formatTilePrice, vixStatus } from './market.ts'

describe('VIX', () => {
  it('calmo sotto 20, nervoso fino a 25, paura da 25', () => {
    expect(vixStatus(15).key).toBe('good')
    expect(vixStatus(22).key).toBe('warning')
    expect(vixStatus(25).key).toBe('critical')
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
