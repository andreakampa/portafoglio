// Cifratura, passo 3 (parte pura, testata): come si cifrano e decifrano i dati di un utente sull'albero di Firebase.
//
// "Unità": il pezzo di dati che si cifra tutto insieme.
// - un portafoglio intero: users/{uid}/portfolio_state/portfolios/{pid}
// - ogni altra voce al secondo livello: users/{uid}/settings/{nome}, users/{uid}/notes/{id}, users/{uid}/portfolio_state/activePortfolioId…
// Restano in chiaro (servono al programma delle notifiche o sono già cifrate):
//   users/{uid}/crypto, users/{uid}/settings/watchlist, users/{uid}/settings/push.
// Su Firebase un'unità cifrata è { "__s": { v, iv, ct } }: si vedono solo le chiavi sopra le unità (id di portafogli, note…).
import { isSealed, openJson, sealJson, type Sealed } from './crypto'

export const SEALED_KEY = '__s'
const PLAIN: string[][] = [['crypto'], ['settings', 'watchlist'], ['settings', 'push']]

export type Segs = string[]
export const split = (path: string): Segs => path.split('/').filter(Boolean)
export const join = (segs: Segs) => segs.join('/')

/** Parte del percorso dopo users/{uid}, oppure null se il percorso non è dei dati di quell'utente. */
export function relOf(path: string, uid: string): Segs | null {
  const s = split(path)
  return s[0] === 'users' && s[1] === uid ? s.slice(2) : null
}

export const isPlain = (rel: Segs) => PLAIN.some(p => p.every((x, i) => rel[i] === x))
/** Il percorso contiene (sotto di sé) qualcosa che resta in chiaro. */
const containsPlain = (rel: Segs) => PLAIN.some(p => rel.length < p.length && rel.every((x, i) => p[i] === x))

/** Profondità dell'unità (in segmenti dopo users/{uid}) per questo ramo. */
export function unitDepth(rel: Segs): number {
  return rel[0] === 'portfolio_state' && rel[1] === 'portfolios' ? 3 : 2
}

/** Se il percorso sta dentro un'unità (più in basso), il percorso dell'unità; altrimenti null. */
export function unitAbove(rel: Segs): Segs | null {
  if (isPlain(rel)) return null
  const d = unitDepth(rel)
  return rel.length > d ? rel.slice(0, d) : null
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
export const sealedOf = (v: unknown): Sealed | null => (isObj(v) && isSealed(v[SEALED_KEY]) ? (v[SEALED_KEY] as Sealed) : null)

/** I segnaposto di Firebase (serverTimestamp) dentro un dato cifrato non verrebbero mai risolti: si mette l'ora del dispositivo. */
function resolvePlaceholders(v: unknown): unknown {
  if (isObj(v)) {
    if (Object.keys(v).length === 1 && v['.sv'] === 'timestamp') return Date.now()
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolvePlaceholders(x)]))
  }
  return Array.isArray(v) ? v.map(resolvePlaceholders) : v
}

/** Valore da scrivere in `path` (assoluto): ogni unità chiusa con la chiave, le parti in chiaro lasciate come sono. */
export async function sealTree(key: CryptoKey, uid: string, path: string, value: unknown): Promise<unknown> {
  const rel = relOf(path, uid)
  if (!rel || value == null || isPlain(rel)) return value
  if (containsPlain(rel) && isObj(value)) return sealChildren(key, uid, path, value)
  if (rel.length >= unitDepth(rel) || !isObj(value)) return { [SEALED_KEY]: await sealJson(key, resolvePlaceholders(value), path) }
  return sealChildren(key, uid, path, value)
}

async function sealChildren(key: CryptoKey, uid: string, path: string, value: Record<string, unknown>) {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value)) out[k] = await sealTree(key, uid, `${path}/${k}`, v)
  return out
}

/** Valore letto da Firebase in `path` (assoluto), con le unità riaperte. */
export async function openTree(key: CryptoKey, path: string, value: unknown): Promise<unknown> {
  const s = sealedOf(value)
  if (s) return openJson(key, s, path)
  if (!isObj(value)) return value
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value)) out[k] = await openTree(key, `${path}/${k}`, v)
  return out
}

/** Valore dentro un oggetto, al sotto-percorso indicato. */
export function getIn(v: unknown, sub: Segs): unknown {
  let cur = v
  for (const k of sub) {
    if (cur == null || typeof cur !== 'object') return null
    cur = (cur as Record<string, unknown>)[k]
  }
  return cur ?? null
}

/** Copia dell'oggetto con il valore cambiato al sotto-percorso (null = tolto, come in Firebase). */
export function setIn(v: unknown, sub: Segs, value: unknown): unknown {
  if (!sub.length) return value ?? null
  const [k, ...rest] = sub as [string, ...string[]]
  const base: Record<string, unknown> = isObj(v) ? { ...v } : Array.isArray(v) ? { ...v } : {}
  const next = setIn(base[k], rest, value)
  if (next == null) delete base[k]
  else base[k] = next
  return Object.keys(base).length ? base : null
}
