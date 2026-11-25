import { describe, expect, it } from 'vitest'
import { PROXY_URL, proxyBase } from './proxy'

describe('proxyBase', () => {
  it('in locale passa dall’inoltro di Vite', () => {
    expect(proxyBase('localhost')).toBe('/__proxy')
    expect(proxyBase('127.0.0.1')).toBe('/__proxy')
  })
  it('sul sito pubblicato usa il Worker', () => {
    expect(proxyBase('andreakampa.github.io')).toBe(PROXY_URL)
  })
})
