// Etichette colorate con icona: un colore per significato (docs/Parita sito vecchio.md, sezione 0).
// Il colore non basta mai da solo: c'è sempre l'icona (stesso disegno delle icone Tabler).
import type { ReactNode } from 'react'
import type { Tone } from './tones'


const PATHS: Record<Tone, ReactNode> = {
  buy: <path d="M12 5v14M5 12h14" />,
  sell: <path d="M5 12h14" />,
  short: <><path d="M3 7l6 6l4 -4l8 8" /><path d="M21 10v7h-7" /></>,
  cover: <><path d="M9 14l-4 -4l4 -4" /><path d="M5 10h11a4 4 0 1 1 0 8h-1" /></>,
  transfer: <><path d="M7 10h14l-4 -4" /><path d="M17 14h-14l4 4" /></>,
  dividend: <><circle cx="12" cy="12" r="9" /><path d="M14.8 9a2 2 0 0 0 -1.8 -1h-2a2 2 0 1 0 0 4h2a2 2 0 1 1 0 4h-2a2 2 0 0 1 -1.8 -1" /><path d="M12 7v10" /></>,
  sim: <><path d="M9 3h6" /><path d="M10 9h4" /><path d="M10 3v6l-4 11a.7 .7 0 0 0 .5 1h11a.7 .7 0 0 0 .5 -1l-4 -11v-6" /></>,
  history: <><path d="M12 8v4l2 2" /><path d="M3.05 11a9 9 0 1 1 .5 4m-.5 5v-5h5" /></>,
  edit: <><path d="M4 20h4l10.5 -10.5a2.83 2.83 0 1 0 -4 -4l-10.5 10.5v4" /><path d="M13.5 6.5l4 4" /></>,
  confirm: <path d="M5 12l5 5l10 -10" />,
  delete: <path d="M18 6l-12 12M6 6l12 12" />,
  neutral: <path d="M13 3v7h6l-8 11v-7h-6l8 -11" />,
}

export function TagIcon({ tone }: { tone: Tone }) {
  return (
    <svg className="tag-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[tone]}
    </svg>
  )
}


export function Tag({ tone, children, title }: { tone: Tone; children: ReactNode; title?: string }) {
  return <span className={`tag tag-${tone}`} title={title}><TagIcon tone={tone} />{children}</span>
}

/** Pulsante piccolo con lo stesso stile (Modifica, Elimina, …). */
export function TagButton({ tone, children, onClick, title }: { tone: Tone; children: ReactNode; onClick: () => void; title?: string }) {
  return <button type="button" className={`tag tag-btn tag-${tone}`} onClick={onClick} title={title}><TagIcon tone={tone} />{children}</button>
}
