// Pagina Movimenti (come ui/storico.js del sito vecchio): periodo a scelta, imposta stimata per movimento,
// totali del periodo e interessi di margine inseriti a mano.
import type { FiscalLine } from './engine/fiscal.ts'
import type { MarginInterestRow, Movement } from './engine/movements.ts'

/** Periodo dal/al (estremi compresi) come intervallo [da, a) usato dal resto della pagina. */
export function customRange(from: string, to: string): [string, string] {
  const a = from || '0000-01-01'
  const b = to || '9999-12-30'
  const [lo, hi] = a <= b ? [a, b] : [b, a]
  const d = new Date(hi + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + 1)
  return [lo, d.toISOString().slice(0, 10)]
}

/** Imposta stimata di ogni vendita/chiusura (dalle righe del cassetto fiscale dello stesso movimento). */
export function taxByMovement(lines: FiscalLine[], list: Movement[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const m of list) {
    if (m.gainEur === null || !m.txId) continue
    const prefix = `${m.assetId}#${m.txId}#`
    const mine = lines.filter(l => l.key.startsWith(prefix))
    if (mine.length) out.set(m.key, mine.reduce((s, l) => s + l.taxEur, 0))
  }
  return out
}

export function periodTotals(list: Movement[], tax: Map<string, number>) {
  let plus = 0
  let minus = 0
  let taxEur = 0
  for (const m of list) {
    if (m.gainEur !== null) {
      if (m.gainEur > 0) plus += m.gainEur
      else minus += m.gainEur
    }
    taxEur += tax.get(m.key) ?? 0
  }
  return { plus, minus, net: plus + minus, tax: taxEur }
}

export interface InterestForm {
  period: string
  amount: string
  currency: string
}

const num = (s: string) => Number(s.trim().replace(',', '.'))

export function validateInterest(f: InterestForm, today: string): string | null {
  if (!/^\d{4}-\d{2}$/.test(f.period)) return 'Scegli il mese.'
  if (f.period > today.slice(0, 7)) return 'Il mese non può essere nel futuro.'
  const a = num(f.amount)
  if (!f.amount.trim() || !Number.isFinite(a) || a <= 0) return 'Scrivi l’importo addebitato (maggiore di zero).'
  if (!/^[A-Z]{3}$/.test(f.currency.trim().toUpperCase())) return 'Valuta non valida.'
  return null
}

/** Stessa forma del sito vecchio; la sincronizzazione IBKR la riconosce e non la duplica. */
export function buildInterest(f: InterestForm, id: string): MarginInterestRow {
  return { id: 'MI' + id, period: f.period, currency: f.currency.trim().toUpperCase(), amount: Math.round(num(f.amount) * 100) / 100 }
}

/** Si eliminano solo quelli inseriti a mano: quelli IBKR tornerebbero alla sincronizzazione successiva. */
export const isManualInterest = (r: MarginInterestRow & { externalId?: string; source?: string }) => !r.externalId && r.source !== 'ibkr'
