// Stress test del margine: cosa succede al conto se tutti i titoli salgono o scendono della stessa percentuale.
// Il prestito (cassa negativa) resta uguale; il margine di mantenimento è una percentuale del valore lordo delle posizioni.
// IBKR liquida senza avviso quando il patrimonio netto scende sotto il mantenimento: qui si calcola a quale variazione succede.
// Funzioni pure, senza rete.

/** Percentuale di mantenimento usata se l'utente non ne ha scelta una (regola standard IBKR per le azioni). */
export const DEFAULT_MAINT_PCT = 25

export interface StressBase {
  /** Esposizione lorda (long + |short|) in EUR. */
  grossEur: number
  /** Valore netto delle posizioni (long − |short|) in EUR. */
  positionsEur: number
  /** Patrimonio netto (posizioni + cassa) in EUR. */
  equityEur: number
  /** Margine di mantenimento in % dell'esposizione lorda. */
  maintPct: number
}

export interface StressResult {
  changePct: number
  grossEur: number
  equityEur: number
  /** Variazione del patrimonio netto in % (la leva la amplifica rispetto a changePct). */
  equityChangePct: number | null
  /** null se il patrimonio netto è zero o negativo. */
  leverage: number | null
  maintEur: number
  /** Liquidità in eccesso: patrimonio netto − mantenimento. Sotto zero IBKR vende. */
  excessEur: number
}

const round = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d

/** Il conto se tutti i titoli variano di changePct (es. −20). */
export function stressMargin(b: StressBase, changePct: number): StressResult {
  const x = changePct / 100
  const r = b.maintPct / 100
  const gross = b.grossEur * (1 + x)
  const equity = b.equityEur + x * b.positionsEur
  const maint = r * gross
  return {
    changePct,
    grossEur: round(gross),
    equityEur: round(equity),
    equityChangePct: b.equityEur > 0 ? round((x * b.positionsEur * 100) / b.equityEur, 1) : null,
    leverage: equity > 0 ? round(gross / equity, 3) : null,
    maintEur: round(maint),
    excessEur: round(equity - maint),
  }
}

/**
 * Variazione dei titoli (in %) a cui la liquidità in eccesso arriva a zero: lì scatta la margin call.
 * Negativa = calo (conto long), positiva = rialzo (conto molto short). 0 se il conto è già sotto il mantenimento.
 * null se non succede in nessuno scenario possibile (i prezzi non scendono sotto −100%).
 */
export function marginCallChangePct(b: StressBase): number | null {
  const r = b.maintPct / 100
  const excessNow = b.equityEur - r * b.grossEur
  if (excessNow <= 0) return 0
  // E + x·N = r·G·(1 + x)  →  x = (r·G − E) / (N − r·G)
  const denom = b.positionsEur - r * b.grossEur
  if (denom === 0) return null
  const x = (r * b.grossEur - b.equityEur) / denom
  return x > -1 ? round(x * 100, 1) : null
}

/** 'call' = IBKR vende; 'near' = cuscinetto sotto metà di quello di oggi; 'ok' altrimenti. */
export function stressLevel(b: StressBase, s: StressResult): 'ok' | 'near' | 'call' {
  if (s.excessEur <= 0) return 'call'
  const today = b.equityEur - (b.maintPct / 100) * b.grossEur
  return s.excessEur < today * 0.5 ? 'near' : 'ok'
}

/** Percentuale di mantenimento valida: un numero maggiore di 0 e fino a 100. */
export function parseMaintPct(text: string | null): number | null {
  const v = parseFloat((text ?? '').replace(',', '.').replace('%', ''))
  return Number.isFinite(v) && v > 0 && v <= 100 ? v : null
}

/** Percentuale scritta a mano nel campo dello scenario (accetta virgola e il segno meno tipografico). */
export function parseChangePct(text: string): number | null {
  const v = parseFloat(text.replace(',', '.').replace('−', '-').replace('%', '').trim())
  return Number.isFinite(v) ? Math.max(-99, Math.min(200, v)) : null
}
