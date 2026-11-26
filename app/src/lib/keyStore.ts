// Chiave dei dati sbloccata, ricordata su questo dispositivo (come la sessione di Firebase) finché non si esce.
// Si salva in IndexedDB come chiave NON estraibile: la pagina può usarla ma nessuno può leggerne i byte.

const DB = 'ptpro-keys'
const STORE = 'keys'

/** Password appena digitata in accesso o registrazione: serve una volta sola per aprire la busta, poi si cancella. */
let pending: { email: string; password: string } | null = null
export const rememberPassword = (email: string, password: string) => { pending = { email: email.trim().toLowerCase(), password } }
export function takePassword(email: string | null): string | null {
  const p = pending
  pending = null
  return p && email && p.email === email.toLowerCase() ? p.password : null
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1)
    r.onupgradeneeded = () => r.result.createObjectStore(STORE)
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open()
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE))
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  } finally {
    db.close()
  }
}

/** Copia non estraibile della chiave, da tenere sul dispositivo. */
export async function nonExtractable(key: CryptoKey): Promise<CryptoKey> {
  if (!key.extractable) return key
  const raw = await crypto.subtle.exportKey('raw', key)
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

/** Ricorda la chiave su questo dispositivo (copia non estraibile). */
export async function storeDeviceKey(uid: string, key: CryptoKey): Promise<void> {
  try {
    const k = await nonExtractable(key)
    await tx('readwrite', s => s.put(k, uid))
  } catch {
    /* navigazione privata o IndexedDB bloccato: si chiederà la password alla prossima apertura */
  }
}

export async function loadDeviceKey(uid: string): Promise<CryptoKey | null> {
  try {
    return ((await tx<CryptoKey | undefined>('readonly', s => s.get(uid))) ?? null)
  } catch {
    return null
  }
}

/** All'uscita: nessuna chiave resta sul dispositivo. */
export async function forgetDeviceKeys(): Promise<void> {
  pending = null
  try {
    await tx('readwrite', s => s.clear())
  } catch {
    /* niente da cancellare */
  }
}
