import { useEffect, useRef, useState } from 'react'
import { moveKey } from '../domain/watchlist'

export interface PillItem {
  key: string
  label: string
  count: number
}

/**
 * Pillole che vanno a capo e si riordinano trascinandole.
 * Col mouse basta trascinare; sul telefono si tiene premuto un attimo e poi si trascina
 * (così lo scorrimento normale della pagina continua a funzionare).
 */
export function SortablePills({ items, active, onSelect, onReorder, label }: {
  items: PillItem[]
  active: string
  onSelect: (key: string) => void
  onReorder: (keys: string[]) => void
  label: string
}) {
  const keys = items.map(i => i.key)
  const [preview, setPreview] = useState<string[] | null>(null)
  const [dragKey, setDragKey] = useState<string | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const st = useRef<{ key: string; x: number; y: number; id: number; dragging: boolean; timer?: number; moved: boolean } | null>(null)
  const justDragged = useRef(false)

  // Mentre si trascina col dito, il browser non deve scorrere la pagina.
  useEffect(() => {
    const el = box.current
    if (!el) return
    const stop = (e: TouchEvent) => {
      if (st.current?.dragging) e.preventDefault()
    }
    el.addEventListener('touchmove', stop, { passive: false })
    return () => el.removeEventListener('touchmove', stop)
  }, [])

  const start = (key: string, id: number) => {
    const s = st.current!
    s.dragging = true
    setDragKey(key)
    setPreview(keys)
    box.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`)?.setPointerCapture(id)
    navigator.vibrate?.(15)
  }

  const end = (commit: boolean) => {
    const s = st.current
    if (s?.timer) clearTimeout(s.timer)
    if (s?.dragging) {
      justDragged.current = true
      setTimeout(() => (justDragged.current = false), 0)
      if (commit && preview && preview.join() !== keys.join()) onReorder(preview)
    }
    st.current = null
    setDragKey(null)
    setPreview(null)
  }

  const shown = preview ? preview.map(k => items.find(i => i.key === k)!).filter(Boolean) : items

  return (
    <div ref={box} className={`pills watch-filter${dragKey ? ' dragging' : ''}`} role="tablist" aria-label={label}>
      {shown.map(f => (
        <button
          key={f.key}
          data-key={f.key}
          type="button"
          role="tab"
          aria-selected={active === f.key}
          className={`pill small-pill ${active === f.key ? 'active' : ''} ${dragKey === f.key ? 'drag-ghost' : ''}`}
          onClick={() => {
            if (!justDragged.current) onSelect(f.key)
          }}
          onContextMenu={e => st.current && e.preventDefault()}
          onPointerDown={e => {
            if (e.button !== 0) return
            st.current = { key: f.key, x: e.clientX, y: e.clientY, id: e.pointerId, dragging: false, moved: false }
            if (e.pointerType !== 'mouse') {
              const { pointerId } = e
              st.current.timer = window.setTimeout(() => st.current && !st.current.moved && start(f.key, pointerId), 400)
            }
          }}
          onPointerMove={e => {
            const s = st.current
            if (!s || s.id !== e.pointerId) return
            const far = Math.hypot(e.clientX - s.x, e.clientY - s.y) > 6
            if (!s.dragging) {
              if (!far) return
              if (e.pointerType === 'mouse') start(s.key, e.pointerId)
              else {
                s.moved = true // il dito si è mosso prima della pressione lunga: è uno scorrimento
                return
              }
            }
            const over = document
              .elementsFromPoint(e.clientX, e.clientY)
              .map(el => (el as HTMLElement).closest<HTMLElement>('.watch-filter .pill'))
              .find(el => el && el.dataset.key !== s.key)
            const target = over?.dataset.key
            if (!target) return
            setPreview(p => {
              const cur = p ?? keys
              return moveKey(cur, s.key, cur.indexOf(target))
            })
          }}
          onPointerUp={() => end(true)}
          onPointerCancel={() => end(false)}
        >
          {f.label} <span className="pill-sub">{f.count}</span>
        </button>
      ))}
    </div>
  )
}
