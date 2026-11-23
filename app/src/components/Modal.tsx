// Finestra sopra la pagina (dialog nativo): Esc o la ✕ la chiudono, il resto della pagina non cambia.
import { useEffect, useRef, type ReactNode } from 'react'

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (d && !d.open) d.showModal()
    return () => d?.close()
  }, [])
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? 'modal-wide' : ''}`}
      aria-label={title}
      onCancel={e => { e.preventDefault(); onClose() }}
      onClick={e => { if (e.target === ref.current) onClose() }}
    >
      <div className="modal-body">
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="btn btn-ghost btn-small" aria-label="Chiudi" onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </dialog>
  )
}
