// Minus inserite a mano (es. da un altro intermediario o da un fondo chiuso): stesse voci del sito vecchio
// (`fiscal.manualLosses` del portafoglio). Il motore fiscale le mette nel cassetto della loro data.
import type { Category, ManualLoss } from './engine/fiscal.ts'

export interface ManualLossForm {
  date: string
  amount: string
  title: string
  categoria: Category
}

export type StoredManualLoss = ManualLoss & { year?: number; tipoAsset?: string }

/** "1.234,5" e "5.000" → migliaia; "204.81" e "204,81" → 204.81. */
const num = (s: string) => {
  const t = s.trim()
  const thousands = t.includes(',') || /^\d{1,3}(\.\d{3})+$/.test(t)
  return Number((thousands ? t.replace(/\./g, '') : t).replace(',', '.'))
}

export function validateManualLoss(f: ManualLossForm, today: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date) || Number.isNaN(Date.parse(f.date))) return 'Scegli la data della minus.'
  if (f.date > today) return 'La data non può essere nel futuro.'
  const a = num(f.amount)
  if (!f.amount.trim() || !Number.isFinite(a) || a <= 0) return 'Scrivi l’importo della minus in euro (maggiore di zero).'
  if (!f.title.trim()) return 'Scrivi da dove viene (es. nome del titolo o della banca).'
  return null
}

export function buildManualLoss(f: ManualLossForm): StoredManualLoss {
  return {
    amount: Math.round(num(f.amount) * 100) / 100,
    date: f.date,
    year: Number(f.date.slice(0, 4)),
    title: f.title.trim(),
    categoria: f.categoria,
  }
}

/** Toglie la voce `index` solo se è ancora quella vista (stessa data e importo); altrimenti `undefined`. */
export function removeManualLoss(list: StoredManualLoss[], index: number, seen: StoredManualLoss): StoredManualLoss[] | undefined {
  const cur = list[index]
  if (!cur || cur.date !== seen.date || Number(cur.amount) !== Number(seen.amount)) return undefined
  return list.filter((_, i) => i !== index)
}

/** Giorni che mancano al 31/12 dell'anno di scadenza (0 se è oggi). */
export function daysToExpiry(expiresYear: number, today: string): number {
  const end = Date.UTC(expiresYear, 11, 31)
  const now = Date.parse(today + 'T00:00:00Z')
  return Math.max(0, Math.round((end - now) / 86400000))
}
