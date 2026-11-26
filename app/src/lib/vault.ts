// Cifratura, passo 3: stessi nomi delle funzioni di firebase/database (ref, onValue, get, set, update, remove, push,
// runTransaction), ma per un amico invitato i suoi dati passano dalla chiave: si cifrano prima di partire e si
// decifrano all'arrivo. Per l'amministratore (nessuna chiave) tutto va diretto a Firebase come prima.
// La logica dell'albero (unità, cosa resta in chiaro) è in vaultTree.ts.
import {
  get as fbGet, onValue as fbOnValue, push as fbPush, ref as fbRef, runTransaction as fbRunTransaction,
  set as fbSet, update as fbUpdate,
} from 'firebase/database'
import { db } from './firebase'
import { getIn, isPlain, join, openTree, relOf, sealTree, setIn, split, unitAbove, type Segs } from './vaultTree'

export { serverTimestamp } from 'firebase/database'

let active: { uid: string; key: CryptoKey } | null = null

/** Chiamata da CryptoGate: da qui in poi i dati di `uid` si cifrano con `key` (null = in chiaro). */
export function setVaultKey(uid: string, key: CryptoKey | null) {
  active = key ? { uid, key } : null
}

export interface VRef {
  path: string
}
export interface VSnap {
  key: string | null
  val(): unknown
  exists(): boolean
}

/** Come ref() di Firebase: il primo argomento (il database) si ignora, c'è uno solo. */
export const ref = (_db: unknown, path = ''): VRef => ({ path: join(split(path)) })

const snap = (path: string, v: unknown): VSnap => ({ key: split(path).at(-1) ?? null, val: () => v ?? null, exists: () => v != null })

/** Percorso dei dati dell'utente attivo, da cifrare; null = va diretto a Firebase. */
function enc(path: string): { key: CryptoKey; uid: string; rel: Segs } | null {
  if (!active) return null
  const rel = relOf(path, active.uid)
  return rel && !isPlain(rel) ? { key: active.key, uid: active.uid, rel } : null
}
const abs = (uid: string, rel: Segs) => join(['users', uid, ...rel])

/** Stringa stabile per confrontare due valori letti da Firebase. */
function stable(v: unknown): string {
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    return `{${Object.keys(o).sort().map(k => `${JSON.stringify(k)}:${stable(o[k])}`).join(',')}}`
  }
  return JSON.stringify(v ?? null)
}

export function onValue(r: VRef, cb: (s: VSnap) => void, onError?: (e: Error) => void): () => void {
  const e = enc(r.path)
  if (!e) return fbOnValue(fbRef(db, r.path), s => cb(snap(r.path, s.val())), onError)
  const unit = unitAbove(e.rel)
  const target = unit ? abs(e.uid, unit) : r.path
  const sub = unit ? e.rel.slice(unit.length) : []
  let seq = 0
  return fbOnValue(
    fbRef(db, target),
    s => {
      const mine = ++seq
      openTree(e.key, target, s.val())
        .then(v => { if (mine === seq) cb(snap(r.path, getIn(v, sub))) })
        .catch(err => onError?.(err as Error))
    },
    onError,
  )
}

export async function get(r: VRef): Promise<VSnap> {
  const e = enc(r.path)
  if (!e) return snap(r.path, (await fbGet(fbRef(db, r.path))).val())
  const unit = unitAbove(e.rel)
  const target = unit ? abs(e.uid, unit) : r.path
  const v = await openTree(e.key, target, (await fbGet(fbRef(db, target))).val())
  return snap(r.path, getIn(v, unit ? e.rel.slice(unit.length) : []))
}

/**
 * Leggi-cambia-scrivi su un'unità cifrata, al sicuro da scritture contemporanee: si scrive solo se sul server
 * c'è ancora ciò che si è letto (altrimenti si rilegge e si riprova). `fn` torna undefined per rinunciare.
 */
async function rmw(key: CryptoKey, uid: string, unitPath: string, fn: (cur: unknown) => unknown): Promise<{ committed: boolean; value: unknown }> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const raw = (await fbGet(fbRef(db, unitPath))).val()
    const cur = await openTree(key, unitPath, raw)
    const next = fn(cur)
    if (next === undefined) return { committed: false, value: cur }
    const sealed = next == null ? null : await sealTree(key, uid, unitPath, next)
    const want = stable(raw)
    // Con la copia locale vuota (null) si propone comunque: il server la rifiuta se non coincide e si riprova col dato vero.
    const r = await fbRunTransaction(fbRef(db, unitPath), c => (c == null || stable(c) === want ? sealed : undefined), { applyLocally: false })
    if (r.committed) return { committed: true, value: next }
  }
  return { committed: false, value: null }
}

export async function set(r: VRef, value: unknown): Promise<void> {
  const e = enc(r.path)
  if (!e) return fbSet(fbRef(db, r.path), value)
  const unit = unitAbove(e.rel)
  if (!unit) return fbSet(fbRef(db, r.path), await sealTree(e.key, e.uid, r.path, value))
  const sub = e.rel.slice(unit.length)
  const res = await rmw(e.key, e.uid, abs(e.uid, unit), cur => setIn(cur, sub, value))
  if (!res.committed) throw new Error('Salvataggio non riuscito: i dati sono cambiati nel frattempo, riprova.')
}

export const remove = (r: VRef) => set(r, null)

/** Più scritture insieme. Le chiavi possono essere percorsi (es. "p1/assets/x"), come in Firebase. */
export async function update(r: VRef, values: Record<string, unknown>): Promise<void> {
  if (!active) return fbUpdate(fbRef(db, r.path), values)
  const { key, uid } = active
  const direct: Record<string, unknown> = {}
  const units = new Map<string, [Segs, unknown][]>()
  for (const [k, v] of Object.entries(values)) {
    const full = join([...split(r.path), ...split(k)])
    const e = enc(full)
    if (!e) direct[full] = v
    else {
      const unit = unitAbove(e.rel)
      if (!unit) direct[full] = await sealTree(key, uid, full, v)
      else {
        const u = abs(uid, unit)
        units.set(u, [...(units.get(u) ?? []), [e.rel.slice(unit.length), v]])
      }
    }
  }
  // Le parti dentro un'unità: si rilegge l'unità, si applicano tutte le modifiche, si richiude.
  for (const [u, changes] of units) {
    const raw = (await fbGet(fbRef(db, u))).val()
    let cur = await openTree(key, u, raw)
    for (const [sub, v] of changes) cur = setIn(cur, sub, v)
    direct[u] = cur == null ? null : await sealTree(key, uid, u, cur)
  }
  await fbUpdate(fbRef(db), direct)
}

/** Come push() di Firebase con un valore: nuova chiave e scrittura. */
export async function push(r: VRef, value: unknown): Promise<{ key: string }> {
  const k = fbPush(fbRef(db, r.path)).key!
  await set(ref(db, `${r.path}/${k}`), value)
  return { key: k }
}

/** Come runTransaction di Firebase: `fn` riceve il valore attuale e torna il nuovo (undefined = rinuncia). */
export async function runTransaction(r: VRef, fn: (cur: unknown) => unknown): Promise<{ committed: boolean; snapshot: VSnap }> {
  const e = enc(r.path)
  if (!e) {
    const res = await fbRunTransaction(fbRef(db, r.path), fn)
    return { committed: res.committed, snapshot: snap(r.path, res.snapshot.val()) }
  }
  const unit = unitAbove(e.rel) ?? e.rel
  const sub = e.rel.slice(unit.length)
  const res = await rmw(e.key, e.uid, abs(e.uid, unit), cur => {
    const next = fn(getIn(cur, sub))
    return next === undefined ? undefined : setIn(cur, sub, next)
  })
  return { committed: res.committed, snapshot: snap(r.path, getIn(res.value, sub)) }
}

/** Per i test. */
export const vaultActive = () => active !== null
