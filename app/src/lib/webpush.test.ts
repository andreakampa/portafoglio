// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { b64u, decryptPayload, encryptPayload, generateVapidKeys, unb64u, vapidHeader } from './webpush'

const subtle = globalThis.crypto.subtle

describe('notifiche Web Push', () => {
  it('base64url avanti e indietro', () => {
    const bytes = new Uint8Array([0, 251, 255, 62, 63, 1])
    expect(unb64u(b64u(bytes))).toEqual(bytes)
  })

  it('il telefono decifra quello che cifra il Worker (RFC 8291)', async () => {
    const ua = (await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair
    const auth = crypto.getRandomValues(new Uint8Array(16))
    const sub = { endpoint: 'https://push.example/abc', keys: { p256dh: b64u(await subtle.exportKey('raw', ua.publicKey)), auth: b64u(auth) } }
    const msg = new TextEncoder().encode(JSON.stringify({ title: 'NVDA', body: 'è salito a 201' }))
    const body = await encryptPayload(msg, sub)
    expect(body.length).toBe(16 + 4 + 1 + 65 + msg.length + 1 + 16) // intestazione + dati + delimitatore + tag GCM
    expect(new TextDecoder().decode(await decryptPayload(body, ua, auth))).toBe(JSON.stringify({ title: 'NVDA', body: 'è salito a 201' }))
  })

  it('firma VAPID verificabile con la chiave pubblica', async () => {
    const keys = await generateVapidKeys('https://andreakampa.github.io/portafoglio/')
    expect(unb64u(keys.publicKey).length).toBe(65)
    const h = await vapidHeader('https://fcm.googleapis.com/fcm/send/xyz', keys, Date.UTC(2026, 10, 22))
    const [, t, k] = /^vapid t=([^,]+), k=(.+)$/.exec(h)!
    expect(k).toBe(keys.publicKey)
    const [head, body, sig] = t!.split('.')
    expect(JSON.parse(new TextDecoder().decode(unb64u(body!)))).toMatchObject({ aud: 'https://fcm.googleapis.com', sub: 'https://andreakampa.github.io/portafoglio/' })
    const pub = await subtle.importKey('raw', unb64u(keys.publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
    expect(await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, unb64u(sig!), new TextEncoder().encode(`${head}.${body}`))).toBe(true)
  })
})

describe('esempio ufficiale RFC 8291 (appendice A)', () => {
  it('stesse chiavi e stesso sale: stesso messaggio cifrato', async () => {
    const asPub = unb64u('BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8')
    const jwk = { kty: 'EC', crv: 'P-256', d: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw', x: b64u(asPub.slice(1, 33)), y: b64u(asPub.slice(33)), ext: true }
    const privateKey = await subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
    const publicKey = await subtle.importKey('raw', asPub, { name: 'ECDH', namedCurve: 'P-256' }, true, [])
    const body = await encryptPayload(
      new TextEncoder().encode('When I grow up, I want to be a watermelon'),
      { endpoint: 'https://push.example/x', keys: { p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', auth: 'BTBZMqHH6r4Tts7J_aSIgg' } },
      { salt: unb64u('DGv6ra1nlYgDCS1FRnbzlw'), serverKeys: { privateKey, publicKey } as CryptoKeyPair },
    )
    expect(b64u(body)).toBe(
      'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
    )
  })
})
