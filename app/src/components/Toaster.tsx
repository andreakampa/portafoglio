import { useEffect, useState } from 'react'
import { onToast, type ToastMsg } from '../lib/toast'

/** Mostra gli avvisi a comparsa per 3,5 secondi, in basso (sopra la barra del telefono). */
export function Toaster() {
  const [list, setList] = useState<ToastMsg[]>([])
  useEffect(
    () =>
      onToast(t => {
        setList(l => [...l.slice(-2), t])
        setTimeout(() => setList(l => l.filter(x => x.id !== t.id)), 3500)
      }),
    [],
  )
  if (!list.length) return null
  return (
    <div className="toaster" role="status" aria-live="polite">
      {list.map(t => (
        <div key={t.id} className={`toast toast-${t.kind}`}>{t.kind === 'ok' ? '✓ ' : '⚠ '}{t.text}</div>
      ))}
    </div>
  )
}
