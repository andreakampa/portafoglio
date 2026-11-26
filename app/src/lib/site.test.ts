import { describe, expect, it } from 'vitest'
import { appUrl, DEFAULT_APP_URL } from './site'

describe('appUrl', () => {
  it('usa l\'indirizzo da cui si apre l\'app', () => {
    expect(appUrl('https://miogruzzolo.pages.dev', '/')).toBe('https://miogruzzolo.pages.dev/')
    expect(appUrl('https://andreakampa.github.io', '/portafoglio/v2/')).toBe('https://andreakampa.github.io/portafoglio/v2/')
  })
  it('in locale usa quello pubblicato', () => {
    expect(appUrl('http://localhost:5173', '/portafoglio/v2/')).toBe(DEFAULT_APP_URL)
    expect(appUrl('https://127.0.0.1:4173', '/')).toBe(DEFAULT_APP_URL)
    expect(appUrl('', '/')).toBe(DEFAULT_APP_URL)
  })
})
