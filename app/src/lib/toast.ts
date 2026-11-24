// Avvisi a comparsa (come core/toast.js del sito vecchio): `toast('Movimento salvato')` da qualsiasi punto dell'app.

export interface ToastMsg {
  id: number
  text: string
  kind: 'ok' | 'error'
}

type Listener = (t: ToastMsg) => void
const listeners = new Set<Listener>()
let next = 1

export function toast(text: string, kind: ToastMsg['kind'] = 'ok') {
  const t = { id: next++, text, kind }
  for (const l of listeners) l(t)
}

export function onToast(l: Listener): () => void {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}
