// Cifratura dei dati degli amici (piano del 25/11/2026, passo 1): solo il modulo, non ancora usato dall'app.
//
// Come funziona:
// - ogni utente ha una "chiave dei dati" casuale (AES-GCM 256) che cifra portafogli, movimenti, note…;
// - la chiave dei dati si salva su Firebase solo chiusa in due "buste": una si apre con la password,
//   l'altra con la chiave di recupero (da stampare alla registrazione);
// - le buste si aprono con una chiave ricavata da password o codice con PBKDF2-SHA256 (600.000 giri);
// - ogni dato cifrato porta con sé il proprio percorso (AAD): non si può spostare un pezzo cifrato altrove.
// Tutto avviene nel browser con Web Crypto: né Firebase né l'amministratore vedono le chiavi.

export const KDF_ITERATIONS = 600_000
const VERSION = 1

export interface Sealed {
  v: number
  iv: string
  ct: string
}

/** Busta della chiave dei dati: sale proprio + chiave dei dati cifrata. */
export interface WrappedKey {
  salt: string
  iterations: number
  iv: string
  ct: string
}

/** Ciò che si salva su Firebase per ritrovare la chiave dei dati. */
export interface KeyEnvelope {
  v: number
  password: WrappedKey
  recovery: WrappedKey
}

const enc = new TextEncoder()
const dec = new TextDecoder()

const toB64 = (b: ArrayBuffer | Uint8Array) => {
  const bytes = b instanceof Uint8Array ? b : new Uint8Array(b)
  let s = ''
  for (const x of bytes) s += String.fromCharCode(x)
  return btoa(s)
}
const fromB64 = (s: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(s), c => c.charCodeAt(0))
const random = (n: number): Uint8Array<ArrayBuffer> => crypto.getRandomValues(new Uint8Array(new ArrayBuffer(n)))

/** Chiave dei dati nuova. Estraibile solo per poterla chiudere nelle buste. */
export function generateDataKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
}

async function deriveKek(secret: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', enc.encode(secret.normalize('NFC')), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['wrapKey', 'unwrapKey'],
  )
}

async function wrap(dataKey: CryptoKey, secret: string, iterations: number): Promise<WrappedKey> {
  const salt = random(16)
  const iv = random(12)
  const kek = await deriveKek(secret, salt, iterations)
  const ct = await crypto.subtle.wrapKey('raw', dataKey, kek, { name: 'AES-GCM', iv })
  return { salt: toB64(salt), iterations, iv: toB64(iv), ct: toB64(ct) }
}

/** Errore con un messaggio già pronto da mostrare. */
export class WrongSecretError extends Error {}

async function unwrap(w: WrappedKey, secret: string): Promise<CryptoKey> {
  const kek = await deriveKek(secret, fromB64(w.salt), w.iterations)
  try {
    return await crypto.subtle.unwrapKey('raw', fromB64(w.ct), kek, { name: 'AES-GCM', iv: fromB64(w.iv) }, { name: 'AES-GCM', length: 256 }, true, [
      'encrypt',
      'decrypt',
    ])
  } catch {
    throw new WrongSecretError('Password o chiave di recupero errata.')
  }
}

// Stesso alfabeto degli inviti: niente caratteri ambigui (0/O, 1/I/L), si detta e si ricopia a mano senza errori.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

/** Chiave di recupero: 24 caratteri (circa 119 bit) in 6 gruppi da 4, es. K7PM-Q2XD-9RWA-… */
export function newRecoveryCode(rnd: (n: number) => Uint8Array = random): string {
  const chars: string[] = []
  while (chars.length < 24) {
    for (const b of rnd(32)) if (b < 248 && chars.length < 24) chars.push(ALPHABET[b % ALPHABET.length]!)
  }
  return Array.from({ length: 6 }, (_, i) => chars.slice(i * 4, i * 4 + 4).join('')).join('-')
}

/** Tollera minuscole, spazi e trattini mancanti o in più. */
export function normalizeRecoveryCode(raw: string): string {
  const c = raw.toUpperCase().replace(/[^A-Z0-9]/g, '')
  return c.length === 24 ? Array.from({ length: 6 }, (_, i) => c.slice(i * 4, i * 4 + 4)).join('-') : c
}

export const isRecoveryCode = (code: string) => /^([A-HJKMNP-Z2-9]{4}-){5}[A-HJKMNP-Z2-9]{4}$/.test(code)

/** Registrazione: chiave dei dati, chiave di recupero da mostrare una volta e buste da salvare. */
export async function createKeyring(password: string, iterations = KDF_ITERATIONS) {
  const dataKey = await generateDataKey()
  const recoveryCode = newRecoveryCode()
  const envelope: KeyEnvelope = {
    v: VERSION,
    password: await wrap(dataKey, password, iterations),
    recovery: await wrap(dataKey, recoveryCode, iterations),
  }
  return { dataKey, recoveryCode, envelope }
}

export const unlockWithPassword = (e: KeyEnvelope, password: string) => unwrap(e.password, password)
export const unlockWithRecovery = (e: KeyEnvelope, code: string) => unwrap(e.recovery, normalizeRecoveryCode(code))

/** Cambio o recupero della password: si richiude solo la busta della password, i dati restano come sono. */
export async function rewrapPassword(e: KeyEnvelope, dataKey: CryptoKey, newPassword: string, iterations = e.password.iterations): Promise<KeyEnvelope> {
  return { ...e, password: await wrap(dataKey, newPassword, iterations) }
}

/** Cifra un valore qualsiasi (JSON). `path` è il percorso su Firebase: il dato si apre solo lì. */
export async function sealJson(key: CryptoKey, value: unknown, path: string): Promise<Sealed> {
  const iv = random(12)
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(path) }, key, enc.encode(JSON.stringify(value ?? null)))
  return { v: VERSION, iv: toB64(iv), ct: toB64(ct) }
}

export async function openJson<T = unknown>(key: CryptoKey, sealed: Sealed, path: string): Promise<T> {
  if (sealed.v !== VERSION) throw new Error(`Versione di cifratura sconosciuta: ${sealed.v}`)
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(sealed.iv), additionalData: enc.encode(path) }, key, fromB64(sealed.ct))
  return JSON.parse(dec.decode(pt)) as T
}

/** Riconosce un dato cifrato letto da Firebase. */
export function isSealed(x: unknown): x is Sealed {
  return !!x && typeof x === 'object' && typeof (x as Sealed).v === 'number' && typeof (x as Sealed).iv === 'string' && typeof (x as Sealed).ct === 'string'
}
