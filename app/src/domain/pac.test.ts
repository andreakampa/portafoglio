import { describe, expect, it } from 'vitest'
import { buildPacTx, describePlan, dueDates, executionOn, isRecorded, parsePlan, scheduledDates, type PacPlan } from './pac.ts'

const monthly: PacPlan = { id: 'p1', portfolioId: 'tr', assetId: 'a', amount: 25, schedule: { type: 'monthly', days: [2, 16] }, from: '2026-09-10' }
const weekly: PacPlan = { id: 'p2', portfolioId: 'tr', assetId: 'a', amount: 30, schedule: { type: 'weekly', weekday: 1 }, from: '2026-05-18' }

describe('scheduledDates', () => {
  it('mensile: giorni 2 e 16, dal giorno di inizio', () => {
    expect(scheduledDates(monthly, '2026-11-20')).toEqual(['2026-09-16', '2026-10-02', '2026-10-16', '2026-11-02', '2026-11-16'])
  })
  it('settimanale: tutti i lunedì', () => {
    expect(scheduledDates(weekly, '2026-06-08')).toEqual(['2026-05-18', '2026-05-25', '2026-06-01', '2026-06-08'])
  })
  it('rispetta la fine del piano e i mesi corti', () => {
    expect(scheduledDates({ ...monthly, to: '2026-10-02' }, '2026-12-31')).toEqual(['2026-09-16', '2026-10-02'])
    expect(scheduledDates({ ...monthly, schedule: { type: 'monthly', days: [31] }, from: '2026-02-01' }, '2026-03-01')).toEqual(['2026-02-28'])
    expect(scheduledDates({ ...monthly, from: '2027-01-01' }, '2026-12-31')).toEqual([])
  })
})

describe('rate già registrate', () => {
  const manual = [{ id: 'x', date: '2026-10-01', type: 'buy', qty: 1, price: 1, source: 'pac' }]
  it('riconosce la chiave del piano e le rate inserite a mano vicine alla data', () => {
    expect(isRecorded(manual, 'p1', '2026-10-02')).toBe(true)
    expect(isRecorded(manual, 'p1', '2026-10-16')).toBe(false)
    expect(isRecorded([{ date: '2026-12-31', type: 'buy', qty: 1, price: 1, pacKey: 'pac:p1:2026-10-16' }], 'p1', '2026-10-16')).toBe(true)
  })
  it('un acquisto non PAC vicino non conta', () => {
    expect(isRecorded([{ date: '2026-10-02', type: 'buy', qty: 1, price: 1 }], 'p1', '2026-10-02')).toBe(false)
  })
  it('dueDates: solo le date passate senza rata', () => {
    expect(dueDates(monthly, manual, '2026-10-16')).toEqual(['2026-09-16']) // 2/10 coperto a mano; il 16/10 è oggi: manca ancora la chiusura
  })
})

describe('executionOn', () => {
  const closes = { '2026-11-02': 22.5, '2026-11-03': 22.6 }
  it('prende la prima chiusura dalla data prevista', () => {
    expect(executionOn(closes, '2026-11-01', '2026-11-10')).toEqual({ date: '2026-11-02', price: 22.5 })
  })
  it('senza chiusura utile (o troppo recente) non c’è esecuzione', () => {
    expect(executionOn(closes, '2026-11-05', '2026-11-20')).toBeNull()
    expect(executionOn(closes, '2026-11-03', '2026-11-03')).toBeNull()
  })
})

describe('buildPacTx e parsePlan', () => {
  it('quantità a 6 decimali, chiave e segno "da confermare"', () => {
    const t = buildPacTx(monthly, '2026-11-02', { date: '2026-11-02', price: 22.475 }, () => 'id1')
    expect(t).toMatchObject({ id: 'id1', date: '2026-11-02', type: 'buy', qty: 1.112347, price: 22.475, commission: 0, source: 'pac', pacKey: 'pac:p1:2026-11-02', priceEstimated: true })
  })
  it('descrive il piano', () => {
    expect(describePlan(monthly)).toBe('25 € il 2 e il 16 del mese')
    expect(describePlan(weekly)).toBe('30 € ogni lunedì')
  })
  it('valida la maschera', () => {
    const f = { assetId: 'a', amount: '25', kind: 'monthly' as const, weekday: '1', days: '2, 16', from: '2026-12-01' }
    expect(parsePlan(f, 'p', 'tr').plan?.schedule).toEqual({ type: 'monthly', days: [2, 16] })
    expect(parsePlan({ ...f, amount: '0' }, 'p', 'tr').error).toBeTruthy()
    expect(parsePlan({ ...f, days: '40' }, 'p', 'tr').error).toBeTruthy()
    expect(parsePlan({ ...f, kind: 'weekly', weekday: '3' }, 'p', 'tr').plan?.schedule).toEqual({ type: 'weekly', weekday: 3 })
  })
})
