import { describe, expect, it } from 'vitest'
import { INVITE_RE, inviteFromUrl, inviteLink, isValidInvite, newInviteCode, normalizeInvite } from './invites'

describe('codici invito', () => {
  it('accetta minuscole e spazi copiati per sbaglio', () => {
    expect(normalizeInvite('  k7pm-q2xd-9rwa \n')).toBe('K7PM-Q2XD-9RWA')
    expect(normalizeInvite('K7PM Q2XD 9RWA')).toBe('K7PMQ2XD9RWA')
  })

  it('valida con la stessa regola di database.rules.json', () => {
    expect(isValidInvite('K7PM-Q2XD-9RWA')).toBe(true)
    expect(isValidInvite('ABC')).toBe(false)
    expect(isValidInvite('K7PM/Q2XD/9RWA')).toBe(false)
    expect(isValidInvite('K7PM.Q2XD')).toBe(false)
  })

  it('genera codici nel formato XXXX-XXXX-XXXX, validi e senza caratteri ambigui', () => {
    for (let i = 0; i < 200; i++) {
      const code = newInviteCode()
      expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/)
      expect(code).toMatch(INVITE_RE)
      expect(code).not.toMatch(/[01ILO]/)
    }
  })

  it('scarta i byte che sbilancerebbero la distribuzione', () => {
    // 255 va scartato; 0 → 'A', 31 → 'A' (31 % 31 = 0), 1 → 'B'
    const bytes = [255, 0, 31, 1, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    expect(newInviteCode(() => Uint8Array.from(bytes))).toBe('AABA-AAAA-AAAA')
  })

  it('non genera due volte lo stesso codice in 1000 tentativi', () => {
    const seen = new Set(Array.from({ length: 1000 }, () => newInviteCode()))
    expect(seen.size).toBe(1000)
  })
})

describe('link di invito', () => {
  it('il link apre la registrazione con il codice', () => {
    const link = inviteLink('K7PM-Q2XD-9RWA')
    expect(link).toBe('https://miogruzzolo.pages.dev/?invito=K7PM-Q2XD-9RWA')
    expect(inviteFromUrl(new URL(link).search)).toBe('K7PM-Q2XD-9RWA')
    expect(inviteFromUrl('?invito=k7pm-q2xd-9rwa')).toBe('K7PM-Q2XD-9RWA')
    expect(inviteFromUrl('?invito=<script>')).toBeNull()
    expect(inviteFromUrl('')).toBeNull()
  })
})
