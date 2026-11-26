import { describe, expect, it } from 'vitest'
import { appUrl } from './site'

describe('appUrl', () => {
  it('è il nuovo indirizzo di Gruzzolo', () => {
    expect(appUrl()).toBe('https://miogruzzolo.pages.dev/')
  })
})
