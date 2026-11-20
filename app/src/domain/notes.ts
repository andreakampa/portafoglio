// Note dell'utente, salvate in users/{uid}/notes/{id}.

export type NoteKind = 'idea' | 'mossa' | 'monitora' | 'evento'

export const NOTE_KINDS: { key: NoteKind; label: string; hint: string }[] = [
  { key: 'idea', label: 'Idea', hint: 'Pensieri e ragionamenti' },
  { key: 'mossa', label: 'Prossima mossa', hint: 'Cosa comprare o vendere' },
  { key: 'monitora', label: 'Da monitorare', hint: 'Titoli da tenere d’occhio' },
  { key: 'evento', label: 'Evento', hint: 'Trimestrali, stacchi dividendo, scadenze' },
]

export interface Note {
  id: string
  kind: NoteKind
  title: string
  body?: string
  tickers?: string[]
  /** Data dell'evento o della scadenza (YYYY-MM-DD). */
  date?: string
  pinned?: boolean
  done?: boolean
  createdAt: number
  updatedAt: number
}

/** "aapl, msft  nvda" → ["AAPL", "MSFT", "NVDA"] */
export function parseTickers(raw: string): string[] {
  return [...new Set(raw.split(/[\s,;]+/).map(t => t.trim().toUpperCase()).filter(t => /^[A-Z0-9.^=-]{1,15}$/.test(t)))]
}

/** Da Firebase (oggetto per id) a elenco, scartando le note malformate. */
export function notesFromDb(raw: unknown): Note[] {
  if (!raw || typeof raw !== 'object') return []
  return Object.entries(raw as Record<string, Partial<Note>>)
    .filter(([, n]) => n && typeof n.title === 'string')
    .map(([id, n]) => ({
      id,
      kind: (['idea', 'mossa', 'monitora', 'evento'] as const).includes(n.kind as NoteKind) ? (n.kind as NoteKind) : 'idea',
      title: n.title!,
      body: n.body ?? '',
      tickers: Array.isArray(n.tickers) ? n.tickers : [],
      date: n.date || undefined,
      pinned: !!n.pinned,
      done: !!n.done,
      createdAt: Number(n.createdAt) || 0,
      updatedAt: Number(n.updatedAt) || Number(n.createdAt) || 0,
    }))
}

/** Prima le fissate e quelle da fare, poi le più recenti; le completate in fondo. */
export function sortNotes(notes: Note[]): Note[] {
  return [...notes].sort(
    (a, b) => Number(!!a.done) - Number(!!b.done) || Number(!!b.pinned) - Number(!!a.pinned) || b.updatedAt - a.updatedAt,
  )
}

/** Note con data da oggi ai prossimi `days` giorni, dalla più vicina. */
export function upcoming(notes: Note[], today: string, days = 30): Note[] {
  const limit = new Date(Date.parse(today + 'T12:00:00Z') + days * 86400000).toISOString().slice(0, 10)
  return notes.filter(n => n.date && !n.done && n.date >= today && n.date <= limit).sort((a, b) => a.date!.localeCompare(b.date!))
}
