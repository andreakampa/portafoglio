// Piani di accumulo (PAC): ogni piano dice quanto, quando e su quale titolo. Le rate maturate si generano da sole,
// al prezzo di chiusura di borsa del giorno di esecuzione (segnate "da confermare" finché non si inserisce il prezzo vero).
// Funzioni pure, senza Firebase né rete.

import type { RawTx } from './engine/types.ts'

export type PacSchedule = { type: 'weekly'; weekday: number } | { type: 'monthly'; days: number[] }

export interface PacPlan {
  id: string
  portfolioId: string
  assetId: string
  /** Importo di ogni rata, in euro. */
  amount: number
  schedule: PacSchedule
  /** Primo giorno da cui il piano genera rate (inclusa). */
  from: string
  /** Ultimo giorno (incluso), se il piano è finito. */
  to?: string
  /** Commissione di ogni rata, in euro. */
  commission?: number
  /** Rate previste da non creare (es. eliminate a mano dai movimenti). */
  skipDates?: string[]
}

export const WEEKDAYS = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato']
const DAY = 86400000
const iso = (t: number) => new Date(t).toISOString().slice(0, 10)
const ms = (d: string) => Date.parse(d + 'T12:00:00Z')

export function describePlan(p: Pick<PacPlan, 'amount' | 'schedule'>): string {
  const amount = `${p.amount.toLocaleString('it-IT')} €`
  if (p.schedule.type === 'weekly') return `${amount} ogni ${WEEKDAYS[p.schedule.weekday]}`
  const days = p.schedule.days
  return `${amount} il ${days.length > 1 ? `${days.slice(0, -1).join(', ')} e il ${days.at(-1)}` : days[0]} del mese`
}

/** Giorni previsti dal piano, da `from` fino a `until` (inclusi). */
export function scheduledDates(plan: PacPlan, until: string): string[] {
  const end = plan.to && plan.to < until ? plan.to : until
  if (end < plan.from) return []
  const out: string[] = []
  if (plan.schedule.type === 'weekly') {
    for (let t = ms(plan.from); iso(t) <= end; t += DAY) if (new Date(t).getUTCDay() === plan.schedule.weekday) out.push(iso(t))
  } else {
    const days = [...new Set(plan.schedule.days)].sort((a, b) => a - b)
    const [fy, fm] = plan.from.split('-').map(Number) as [number, number]
    const [ey, em] = end.split('-').map(Number) as [number, number]
    for (let y = fy, m = fm; y < ey || (y === ey && m <= em); m === 12 ? ((y += 1), (m = 1)) : (m += 1)) {
      const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
      for (const d of days) {
        const date = `${y}-${String(m).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`
        if (date >= plan.from && date <= end) out.push(date)
      }
    }
  }
  return out
}

/** Una rata è già registrata se ha la stessa chiave o se c'è un acquisto PAC entro 3 giorni dalla data prevista (inserito a mano). */
export function isRecorded(txs: RawTx[], planId: string, date: string): boolean {
  return txs.some(
    t => t.pacKey === `pac:${planId}:${date}` || (t.source === 'pac' && t.type === 'buy' && Math.abs(ms(t.date) - ms(date)) <= 3 * DAY),
  )
}

/** Date previste già passate (fino a ieri: serve la chiusura) che non hanno ancora una rata. */
export function dueDates(plan: PacPlan, txs: RawTx[], today: string): string[] {
  const yesterday = iso(ms(today) - DAY)
  const skip = new Set(plan.skipDates ?? [])
  return scheduledDates(plan, yesterday).filter(d => !skip.has(d) && !isRecorded(txs, plan.id, d))
}

/** Giorno di esecuzione e prezzo: la prima chiusura di borsa dalla data prevista (entro 7 giorni, non oltre ieri). */
export function executionOn(closes: Record<string, number>, date: string, today: string): { date: string; price: number } | null {
  const yesterday = iso(ms(today) - DAY)
  for (let i = 0; i <= 7; i++) {
    const d = iso(ms(date) + i * DAY)
    if (d > yesterday) return null
    const price = closes[d]
    if (price && price > 0) return { date: d, price }
  }
  return null
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6

/** `rate`: unità della valuta del titolo per 1 EUR il giorno dell'esecuzione (1 per i titoli in euro). */
export function buildPacTx(plan: PacPlan, plannedDate: string, exec: { date: string; price: number }, newId: () => string, rate = 1): RawTx {
  return {
    id: newId(),
    date: exec.date,
    type: 'buy',
    qty: round6((plan.amount * rate) / exec.price),
    price: exec.price,
    commission: plan.commission ?? 0,
    commissionCurrency: 'EUR',
    importoPac: plan.amount,
    source: 'pac',
    pacKey: `pac:${plan.id}:${plannedDate}`,
    priceEstimated: true,
  }
}

export interface PlanForm {
  assetId: string
  amount: string
  kind: 'weekly' | 'monthly'
  weekday: string
  days: string
  from: string
  /** Fine del piano (vuoto = senza fine). */
  to: string
  commission: string
}

export function formFromPlan(p: PacPlan): PlanForm {
  return {
    assetId: p.assetId,
    amount: String(p.amount).replace('.', ','),
    kind: p.schedule.type,
    weekday: p.schedule.type === 'weekly' ? String(p.schedule.weekday) : '1',
    days: p.schedule.type === 'monthly' ? p.schedule.days.join(', ') : '2, 16',
    from: p.from,
    to: p.to ?? '',
    commission: p.commission ? String(p.commission).replace('.', ',') : '',
  }
}

/** Con `previous` (modifica) si conservano le rate saltate. */
export function parsePlan(f: PlanForm, id: string, portfolioId: string, previous?: PacPlan): { plan?: PacPlan; error?: string } {
  if (!f.assetId) return { error: 'Scegli il titolo.' }
  const amount = Number(f.amount.trim().replace(',', '.'))
  if (!(amount > 0)) return { error: 'L’importo deve essere maggiore di zero.' }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.from) || Number.isNaN(Date.parse(f.from))) return { error: 'Scegli la data di inizio.' }
  const to = f.to.trim()
  if (to && (!/^\d{4}-\d{2}-\d{2}$/.test(to) || to < f.from)) return { error: 'La data di fine deve venire dopo l’inizio.' }
  const commission = f.commission.trim() ? Number(f.commission.trim().replace(',', '.')) : 0
  if (!Number.isFinite(commission) || commission < 0) return { error: 'La commissione non è valida.' }
  const extra = { ...(to ? { to } : {}), ...(commission ? { commission } : {}), ...(previous?.skipDates?.length ? { skipDates: previous.skipDates } : {}) }
  if (f.kind === 'weekly') {
    const weekday = Number(f.weekday)
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) return { error: 'Scegli il giorno della settimana.' }
    return { plan: { id, portfolioId, assetId: f.assetId, amount, schedule: { type: 'weekly', weekday }, from: f.from, ...extra } }
  }
  const days = f.days.split(/[\s,;e]+/).filter(Boolean).map(Number)
  if (!days.length || days.some(d => !Number.isInteger(d) || d < 1 || d > 31)) return { error: 'Scrivi i giorni del mese tra 1 e 31, per esempio "2, 16".' }
  const sorted = [...new Set(days)].sort((a, b) => a - b)
  return { plan: { id, portfolioId, assetId: f.assetId, amount, schedule: { type: 'monthly', days: sorted }, from: f.from, ...extra } }
}

/** Piano e data prevista di una rata creata dal piano (dalla sua chiave), o null. */
export function pacKeyOf(tx: Pick<RawTx, 'pacKey'>): { planId: string; date: string } | null {
  const m = /^pac:(.+):(\d{4}-\d{2}-\d{2})$/.exec(tx.pacKey ?? '')
  return m ? { planId: m[1]!, date: m[2]! } : null
}

export interface PlanRate {
  date: string
  qty: number
  price: number
  commissionEur: number
  /** Importo in euro della rata (quello del piano, o quantità × prezzo per le rate in euro scritte a mano). */
  amountEur: number
  estimated: boolean
}

export interface PlanSummary {
  rates: PlanRate[]
  totalEur: number
  commissionsEur: number
  /** Prossima rata prevista (da oggi), o null se il piano è finito. */
  nextDate: string | null
}

/**
 * Riepilogo del piano come nel sito vecchio: rate fatte, versato, commissioni, prossima rata.
 * `untagged`: conta anche le rate PAC senza chiave (scritte a mano o dal sito vecchio): si dà al primo piano del titolo.
 */
export function planSummary(plan: PacPlan, txs: RawTx[], today: string, currency = 'EUR', untagged = true): PlanSummary {
  const rates = txs
    .filter(t => t && t.type === 'buy' && (pacKeyOf(t)?.planId === plan.id || (untagged && t.source === 'pac' && !t.pacKey)))
    .map(t => {
      const qty = Number(t.qty) || 0
      const price = Number(t.price) || 0
      const own = Number(t.importoPac) || 0
      return {
        date: t.date,
        qty,
        price,
        commissionEur: (t.commissionCurrency ?? 'EUR').toUpperCase() === 'EUR' ? Number(t.commission) || 0 : 0,
        amountEur: own || (currency === 'EUR' ? qty * price : plan.amount),
        estimated: !!t.priceEstimated,
      }
    })
    .sort((a, b) => b.date.localeCompare(a.date))
  const skip = new Set(plan.skipDates ?? [])
  const ahead = scheduledDates(plan, iso(ms(today) + 70 * DAY)).filter(d => d >= today && !skip.has(d))
  return {
    rates,
    totalEur: rates.reduce((s, r) => s + r.amountEur, 0),
    commissionsEur: rates.reduce((s, r) => s + r.commissionEur, 0),
    nextDate: ahead[0] ?? null,
  }
}

/**
 * Rate previste da segnare come saltate quando si elimina un movimento: quella della sua chiave,
 * oppure (rata PAC senza chiave) quelle dei piani dello stesso titolo entro 3 giorni.
 */
export function pacSkipsFor(tx: RawTx, plans: PacPlan[], portfolioId: string, assetId: string): { planId: string; date: string }[] {
  const own = pacKeyOf(tx)
  if (own) return [own]
  if (tx.source !== 'pac' || tx.type !== 'buy' || !tx.date) return []
  const until = iso(ms(tx.date) + 3 * DAY)
  return plans
    .filter(p => p.portfolioId === portfolioId && p.assetId === assetId)
    .flatMap(p => scheduledDates(p, until).filter(d => Math.abs(ms(d) - ms(tx.date)) <= 3 * DAY).map(date => ({ planId: p.id, date })))
}
