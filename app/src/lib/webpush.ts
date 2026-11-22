// Notifiche Web Push senza librerie: firma VAPID (RFC 8292) e cifratura aes128gcm (RFC 8291) con WebCrypto.
// Gira sia nel Worker Cloudflare (che manda le notifiche) sia nei test (Node).

export interface PushSub {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

export interface VapidKeys {
  /** Chiave pubblica non compressa (65 byte), base64url: è anche la applicationServerKey dell'app. */
  publicKey: string
  /** Chiave privata (scalare d, 32 byte), base64url. Segreta: solo nel Worker. */
  privateKey: string
  /** Contatto richiesto dallo standard (URL o mailto:). */
  subject: string
}

const enc = new TextEncoder()
const subtle = () => globalThis.crypto.subtle

export const b64u = (buf: ArrayBuffer | Uint8Array) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
export const unb64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0))

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let i = 0
  for (const p of parts) {
    out.set(p, i)
    i += p.length
  }
  return out
}

async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await subtle().importKey('raw', key as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await subtle().sign('HMAC', k, data as BufferSource))
}
/** HKDF con un solo blocco di uscita (bastano 32 byte). */
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const prk = await hmac(salt, ikm)
  return (await hmac(prk, concat(info, new Uint8Array([1])))).slice(0, length)
}

const publicRaw = async (key: CryptoKey) => new Uint8Array(await subtle().exportKey('raw', key))

async function importPublic(raw: Uint8Array, usage: 'ECDH' | 'ECDSA') {
  return subtle().importKey('raw', raw as BufferSource, { name: usage, namedCurve: 'P-256' }, true, usage === 'ECDSA' ? ['verify'] : [])
}

async function ecdh(priv: CryptoKey, pub: Uint8Array): Promise<Uint8Array> {
  const p = await importPublic(pub, 'ECDH')
  return new Uint8Array(await subtle().deriveBits({ name: 'ECDH', public: p }, priv, 256))
}

/** Nuova coppia di chiavi VAPID (da fare una volta: la privata va nel Worker come secret). */
export async function generateVapidKeys(subject: string): Promise<VapidKeys> {
  const kp = (await subtle().generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair
  const jwk = await subtle().exportKey('jwk', kp.privateKey)
  return { publicKey: b64u(await publicRaw(kp.publicKey)), privateKey: jwk.d!, subject }
}

/** Intestazione Authorization "vapid t=…, k=…" per il servizio push dell'endpoint. */
export async function vapidHeader(endpoint: string, keys: VapidKeys, now = Date.now()): Promise<string> {
  const pub = unb64u(keys.publicKey)
  const jwk = { kty: 'EC', crv: 'P-256', d: keys.privateKey, x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33, 65)), ext: true }
  const key = await subtle().importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  const head = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const body = b64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: keys.subject })))
  const sig = await subtle().sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${head}.${body}`))
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${keys.publicKey}`
}

/** Cifra il contenuto per l'abbonamento (un solo record, RFC 8291 + RFC 8188). */
export async function encryptPayload(
  payload: Uint8Array,
  sub: PushSub,
  opts: { salt?: Uint8Array; serverKeys?: CryptoKeyPair } = {},
): Promise<Uint8Array> {
  const uaPublic = unb64u(sub.keys.p256dh)
  const authSecret = unb64u(sub.keys.auth)
  const as = opts.serverKeys ?? ((await subtle().generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair)
  const asPublic = await publicRaw(as.publicKey)
  const salt = opts.salt ?? globalThis.crypto.getRandomValues(new Uint8Array(16))
  const shared = await ecdh(as.privateKey, uaPublic)
  const ikm = await hkdf(authSecret, shared, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32)
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12)
  const key = await subtle().importKey('raw', cek as BufferSource, 'AES-GCM', false, ['encrypt'])
  const cipher = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv: nonce as BufferSource }, key, concat(payload, new Uint8Array([2])) as BufferSource))
  const rs = new Uint8Array([0, 0, 16, 0]) // 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher)
}

/** Decifra (lato telefono): serve ai test per verificare la cifratura. */
export async function decryptPayload(body: Uint8Array, uaKeys: CryptoKeyPair, authSecret: Uint8Array): Promise<Uint8Array> {
  const salt = body.slice(0, 16)
  const idlen = body[20]!
  const asPublic = body.slice(21, 21 + idlen)
  const cipher = body.slice(21 + idlen)
  const uaPublic = await publicRaw(uaKeys.publicKey)
  const shared = await ecdh(uaKeys.privateKey, asPublic)
  const ikm = await hkdf(authSecret, shared, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32)
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12)
  const key = await subtle().importKey('raw', cek as BufferSource, 'AES-GCM', false, ['decrypt'])
  const plain = new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: nonce as BufferSource }, key, cipher as BufferSource))
  let end = plain.length - 1
  while (end >= 0 && plain[end] === 0) end-- // padding
  return plain.slice(0, end) // l'ultimo byte (2) segna la fine
}

/**
 * Manda una notifica. Ritorna lo stato HTTP: 201 = consegnata al servizio push;
 * 404/410 = abbonamento scaduto (va cancellato).
 */
export async function sendPush(sub: PushSub, data: unknown, keys: VapidKeys, ttlSeconds = 6 * 3600): Promise<number> {
  const body = await encryptPayload(enc.encode(JSON.stringify(data)), sub)
  const r = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidHeader(sub.endpoint, keys),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(ttlSeconds),
      Urgency: 'high',
    },
    body: body as BodyInit,
  })
  return r.status
}
