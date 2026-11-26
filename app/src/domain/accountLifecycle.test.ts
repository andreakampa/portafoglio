import { describe, expect, it } from 'vitest'
import { bannersFor, canPurge, closingMail, closingNotice, daysLeft, exportFileName, exportPayload, mailto, suspension, suspensionMail } from './accountLifecycle'

const NOW = Date.UTC(2026, 10, 25, 12)
const DAY = 86_400_000

describe('sospensione', () => {
  it('cancellazione 30 giorni dopo', () => {
    const s = suspension(NOW)
    expect(s.suspendedAt).toBe(NOW)
    expect(s.deleteAfter - NOW).toBe(30 * DAY)
  })
  it('si cancella solo a periodo finito', () => {
    const s = suspension(NOW)
    expect(canPurge(s, NOW + 29 * DAY)).toBe(false)
    expect(canPurge(s, NOW + 30 * DAY)).toBe(true)
    expect(canPurge({}, NOW)).toBe(false)
  })
  it('giorni mancanti mai negativi', () => {
    expect(daysLeft(NOW + 1.5 * DAY, NOW)).toBe(2)
    expect(daysLeft(NOW - DAY, NOW)).toBe(0)
  })
})

describe('avvisi in app', () => {
  it('nessun avviso di norma', () => {
    expect(bannersFor({ email: 'a@b.it' }, null, NOW)).toEqual([])
  })
  it('sospeso: data di cancellazione e giorni', () => {
    const [b] = bannersFor({ ...suspension(NOW) }, null, NOW + 10 * DAY)
    expect(b!.tone).toBe('error')
    expect(b!.text).toContain('tra 20 giorni')
    expect(b!.text).toContain('25 dicembre 2026')
  })
  it('chiusura: 60 giorni e messaggio', () => {
    const n = closingNotice(NOW, '  Grazie a tutti  ')
    expect(n.closesAt! - NOW).toBe(60 * DAY)
    const [b] = bannersFor(null, n, NOW)
    expect(b!.title).toContain('24 gennaio 2027')
    expect(b!.text).toContain('Mancano 60 giorni')
    expect(b!.text).toContain('Grazie a tutti')
  })
  it('sospensione prima della chiusura', () => {
    expect(bannersFor(suspension(NOW), closingNotice(NOW), NOW).map(b => b.tone)).toEqual(['error', 'warn'])
  })
})

describe('email', () => {
  it('mailto con spazi %20 e destinatari in copia nascosta', () => {
    const u = mailto({ bcc: ['a@b.it', 'c@d.it'], subject: 'Ciao a tutti', body: 'riga 1\nriga 2' })
    expect(u.startsWith('mailto:?')).toBe(true)
    expect(u).toContain('bcc=a%40b.it%2Cc%40d.it')
    expect(u).toContain('subject=Ciao%20a%20tutti')
    expect(u).not.toContain('+')
    expect(decodeURIComponent(u)).toContain('riga 1\nriga 2')
  })
  it('sospensione: date e indirizzo dell\'app', () => {
    const u = decodeURIComponent(suspensionMail('anna@test.it', suspension(NOW), 'https://x.it/'))
    expect(u.startsWith('mailto:anna%40test.it') || u.startsWith('mailto:anna@test.it')).toBe(true)
    expect(u).toContain('25 novembre 2026')
    expect(u).toContain('25 dicembre 2026')
    expect(u).toContain('https://x.it/')
  })
  it('chiusura: tutti in ccn', () => {
    const u = decodeURIComponent(closingMail(['a@b.it'], closingNotice(NOW), 'https://x.it/'))
    expect(u).toContain('bcc=a@b.it')
    expect(u).toContain('24 gennaio 2027')
  })
})

describe('esportazione', () => {
  it('nome del file con la data', () => {
    expect(exportFileName(NOW)).toBe('gruzzolo-miei-dati-2026-11-25.json')
  })
  it('contiene tutti i dati', () => {
    const p = exportPayload('a@b.it', { settings: { x: 1 } }, NOW)
    expect(p.account).toBe('a@b.it')
    expect(p.dati).toEqual({ settings: { x: 1 } })
    expect(exportPayload(null, null, NOW).dati).toEqual({})
  })
})
