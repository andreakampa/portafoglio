// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  createKeyring, isRecoveryCode, isSealed, newRecoveryCode, normalizeRecoveryCode, openJson, rewrapPassword, sealJson,
  unlockWithPassword, unlockWithRecovery, WrongSecretError,
} from './crypto'

// Pochi giri nei test: la sicurezza non cambia la logica, solo il tempo.
const IT = 1000
const PATH = 'users/u1/portfolio_state/portfolios/p1'
const data = { name: 'IBKR', assets: { aapl: { qty: 10, pmc: 150.25 } }, note: 'àèìòù €' }

describe('chiave di recupero', () => {
  it('24 caratteri senza ambigui, in 6 gruppi', () => {
    const c = newRecoveryCode()
    expect(isRecoveryCode(c)).toBe(true)
    expect(c).not.toMatch(/[01OIL]/)
  })
  it('tollera minuscole, spazi e trattini', () => {
    const c = newRecoveryCode()
    expect(normalizeRecoveryCode(` ${c.toLowerCase().replace(/-/g, ' ')} `)).toBe(c)
    expect(normalizeRecoveryCode(c.replace(/-/g, ''))).toBe(c)
  })
  it('ogni volta diversa', () => {
    expect(newRecoveryCode()).not.toBe(newRecoveryCode())
  })
})

describe('buste della chiave dei dati', () => {
  it('si apre con la password e con la chiave di recupero, e danno la stessa chiave', async () => {
    const { dataKey, recoveryCode, envelope } = await createKeyring('password-lunga', IT)
    const sealed = await sealJson(dataKey, data, PATH)
    const k1 = await unlockWithPassword(envelope, 'password-lunga')
    const k2 = await unlockWithRecovery(envelope, recoveryCode.toLowerCase())
    expect(await openJson(k1, sealed, PATH)).toEqual(data)
    expect(await openJson(k2, sealed, PATH)).toEqual(data)
  })
  it('password o codice sbagliati: errore chiaro', async () => {
    const { envelope } = await createKeyring('giusta', IT)
    await expect(unlockWithPassword(envelope, 'sbagliata')).rejects.toBeInstanceOf(WrongSecretError)
    await expect(unlockWithRecovery(envelope, newRecoveryCode())).rejects.toBeInstanceOf(WrongSecretError)
  })
  it('nella busta non c\'è nulla in chiaro', async () => {
    const { envelope, recoveryCode } = await createKeyring('password-lunga', IT)
    const text = JSON.stringify(envelope)
    expect(text).not.toContain('password-lunga')
    expect(text).not.toContain(recoveryCode)
    expect(envelope.password.salt).not.toBe(envelope.recovery.salt)
  })
  it('cambio password: la vecchia non apre più, i dati restano leggibili', async () => {
    const { dataKey, envelope } = await createKeyring('vecchia', IT)
    const sealed = await sealJson(dataKey, data, PATH)
    const next = await rewrapPassword(envelope, dataKey, 'nuova')
    await expect(unlockWithPassword(next, 'vecchia')).rejects.toBeInstanceOf(WrongSecretError)
    expect(await openJson(await unlockWithPassword(next, 'nuova'), sealed, PATH)).toEqual(data)
    expect(next.recovery).toEqual(envelope.recovery)
  })
  it('recupero dopo password dimenticata: chiave di recupero, poi password nuova', async () => {
    const { recoveryCode, envelope } = await createKeyring('dimenticata', IT)
    const key = await unlockWithRecovery(envelope, recoveryCode)
    const next = await rewrapPassword(envelope, key, 'nuova')
    await expect(unlockWithPassword(next, 'nuova')).resolves.toBeDefined()
  })
})

describe('dati cifrati', () => {
  it('ogni scrittura ha un IV nuovo: due cifrature uguali sono diverse', async () => {
    const { dataKey } = await createKeyring('p', IT)
    const a = await sealJson(dataKey, data, PATH)
    const b = await sealJson(dataKey, data, PATH)
    expect(a.iv).not.toBe(b.iv)
    expect(a.ct).not.toBe(b.ct)
    expect(isSealed(a)).toBe(true)
    expect(isSealed(data)).toBe(false)
    expect(JSON.stringify(a)).not.toContain('IBKR')
  })
  it('un dato spostato in un altro percorso non si apre', async () => {
    const { dataKey } = await createKeyring('p', IT)
    const s = await sealJson(dataKey, data, PATH)
    await expect(openJson(dataKey, s, 'users/u1/portfolio_state/portfolios/p2')).rejects.toThrow()
  })
  it('un dato manomesso non si apre', async () => {
    const { dataKey } = await createKeyring('p', IT)
    const s = await sealJson(dataKey, data, PATH)
    const bytes = Uint8Array.from(atob(s.ct), c => c.charCodeAt(0))
    bytes[0]! ^= 1
    const ct = btoa(String.fromCharCode(...bytes))
    await expect(openJson(dataKey, { ...s, ct }, PATH)).rejects.toThrow()
  })
  it('la chiave di un altro utente non apre', async () => {
    const a = await createKeyring('p', IT)
    const b = await createKeyring('p', IT)
    const s = await sealJson(a.dataKey, data, PATH)
    await expect(openJson(b.dataKey, s, PATH)).rejects.toThrow()
  })
  it('valori semplici e vuoti', async () => {
    const { dataKey } = await createKeyring('p', IT)
    for (const v of [0, '', [], null, { a: [1, 2] }]) expect(await openJson(dataKey, await sealJson(dataKey, v, PATH), PATH)).toEqual(v)
  })
})
