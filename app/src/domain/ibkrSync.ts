// Stato dell'ultima sincronizzazione IBKR, scritto dal Worker ibkr-sync in users/{uid}/ibkr_sync.

export interface SyncStatus {
  /** ISO dell'ultima sincronizzazione riuscita. */
  lastRun?: string
  reportFrom?: string
  reportTo?: string
  added: string[]
  linked: string[]
  /** Dividendi, interessi e altri movimenti di cassa importati. */
  cashAdded: string[]
  review: string[]
  skipped: string[]
  /** Portafoglio che la sincronizzazione aggiorna (scritto dal Worker). */
  portfolioId?: string
  /** true = l'ultimo giro non ha scaricato nulla perché l'utente l'ha messa in pausa. */
  paused?: boolean
  /** Ultimo errore (resta finché una sincronizzazione non riesce di nuovo). */
  lastError?: { at: string; message: string }
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
// Firebase non salva gli array vuoti: arrivano come campo assente.

/** Da Firebase a stato, tollerando campi mancanti. Null se non c'è ancora nulla. */
export function syncStatusFromDb(raw: unknown): SyncStatus | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const err = r.lastError as { at?: unknown; message?: unknown } | undefined
  return {
    lastRun: typeof r.lastRun === 'string' ? r.lastRun : undefined,
    reportFrom: typeof r.reportFrom === 'string' ? r.reportFrom : undefined,
    reportTo: typeof r.reportTo === 'string' ? r.reportTo : undefined,
    added: strings(r.added),
    linked: strings(r.linked),
    cashAdded: strings(r.cashAdded),
    review: strings(r.review),
    skipped: strings(r.skipped),
    portfolioId: typeof r.portfolioId === 'string' ? r.portfolioId : undefined,
    paused: r.paused === true || undefined,
    lastError: err && typeof err.message === 'string' ? { at: typeof err.at === 'string' ? err.at : '', message: err.message } : undefined,
  }
}

/** Riassunto in una riga: "3 operazioni importate, 1 da controllare". */
export function syncHeadline(s: SyncStatus): string {
  const imp = s.added.length === 1 ? '1 operazione importata' : `${s.added.length} operazioni importate`
  const cash = s.cashAdded.length ? `, ${s.cashAdded.length} movimenti di cassa` : ''
  return `${imp}${cash}, ${s.review.length} da controllare`
}
