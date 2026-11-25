import { describe, expect, it } from 'vitest'
import { buildCsp, CSP_DIRECTIVES } from './csp'

describe('Content Security Policy', () => {
  const csp = buildCsp()
  const directive = (name: string) => csp.split('; ').find(d => d.startsWith(`${name} `)) ?? ''

  it('accetta solo il codice dell’app: niente script in linea, eval o siti esterni', () => {
    expect(directive('script-src')).toBe("script-src 'self' https://*.europe-west1.firebasedatabase.app http://127.0.0.1:9000")
    expect(csp).not.toContain('unsafe-inline')
    expect(csp).not.toContain('unsafe-eval')
    expect(directive('object-src')).toBe("object-src 'none'")
  })

  it('non contiene jolly generici', () => {
    for (const values of Object.values(CSP_DIRECTIVES)) {
      for (const v of values) expect(['*', 'https:', 'http:', 'wss:']).not.toContain(v)
    }
  })

  it('permette le connessioni che servono all’app', () => {
    const connect = directive('connect-src')
    expect(connect).toContain('https://finance-proxy.andrea-kampa.workers.dev')
    expect(connect).toContain('https://identitytoolkit.googleapis.com')
    expect(connect).toContain('wss://*.europe-west1.firebasedatabase.app')
  })

  it('permette i siti dei loghi usati da TickerLogo', () => {
    const img = directive('img-src')
    for (const host of ['financialmodelingprep.com', 'assets.parqet.com', 'eodhd.com']) expect(img).toContain(`https://${host}`)
  })
})
