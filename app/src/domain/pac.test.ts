import { describe, expect, it } from 'vitest'
import { buildPacTx, describePlan, dueDates, executionOn, formFromPlan, isRecorded, pacKeyOf, pacSkipsFor, parsePlan, planSummary, scheduledDates, type PacPlan } from './pac.ts'

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
    const f = { assetId: 'a', amount: '25', kind: 'monthly' as const, weekday: '1', days: '2, 16', from: '2026-12-01', to: '', commission: '' }
    expect(parsePlan(f, 'p', 'tr').plan?.schedule).toEqual({ type: 'monthly', days: [2, 16] })
    expect(parsePlan({ ...f, amount: '0' }, 'p', 'tr').error).toBeTruthy()
    expect(parsePlan({ ...f, days: '40' }, 'p', 'tr').error).toBeTruthy()
    expect(parsePlan({ ...f, kind: 'weekly', weekday: '3' }, 'p', 'tr').plan?.schedule).toEqual({ type: 'weekly', weekday: 3 })
  })
})

describe('piano completo (come il sito vecchio)', () => {
  const f = { assetId: 'a', amount: '25', kind: 'monthly' as const, weekday: '1', days: '2, 16', from: '2026-09-10', to: '', commission: '' }
  it('fine del piano e commissione per rata; la modifica conserva le rate saltate', () => {
    expect(parsePlan({ ...f, to: '2027-06-30', commission: '1,5' }, 'p', 'tr').plan).toMatchObject({ to: '2027-06-30', commission: 1.5 })
    expect(parsePlan({ ...f, to: '2026-01-01' }, 'p', 'tr').error).toMatch(/fine/)
    expect(parsePlan(f, 'p1', 'tr', { ...monthly, skipDates: ['2026-10-02'] }).plan?.skipDates).toEqual(['2026-10-02'])
    expect(formFromPlan({ ...monthly, to: '2027-01-01', commission: 0.99 })).toMatchObject({ amount: '25', days: '2, 16', to: '2027-01-01', commission: '0,99' })
  })
  it('una rata saltata non torna', () => {
    expect(dueDates({ ...monthly, skipDates: ['2026-10-02'] }, [], '2026-10-20')).toEqual(['2026-09-16', '2026-10-16'])
  })
  it('rata con commissione e su un titolo in dollari (importo in euro × cambio)', () => {
    const t = buildPacTx({ ...monthly, commission: 1 }, '2026-11-02', { date: '2026-11-02', price: 110 }, () => 'x', 1.1)
    expect(t.qty).toBeCloseTo(0.25, 8)
    expect(t).toMatchObject({ commission: 1, commissionCurrency: 'EUR' })
    expect(pacKeyOf(t)).toEqual({ planId: 'p1', date: '2026-11-02' })
    expect(pacKeyOf({ pacKey: undefined })).toBeNull()
  })
  it('riepilogo: rate fatte, versato, commissioni, prossima rata', () => {
    const txs = [
      buildPacTx({ ...monthly, commission: 1 }, '2026-09-16', { date: '2026-09-16', price: 25 }, () => 'a'),
      buildPacTx(monthly, '2026-10-02', { date: '2026-10-02', price: 20 }, () => 'b'),
      { id: 'm', date: '2026-10-17', type: 'buy', qty: 1, price: 25, source: 'pac' }, // a mano, vicino al 16/10
      { id: 'n', date: '2026-10-05', type: 'buy', qty: 3, price: 10 }, // acquisto normale
    ]
    const s = planSummary(monthly, txs, '2026-11-10')
    expect(s.rates.map(r => r.date)).toEqual(['2026-10-17', '2026-10-02', '2026-09-16'])
    expect(s.totalEur).toBeCloseTo(75, 8)
    expect(s.commissionsEur).toBe(1)
    expect(s.nextDate).toBe('2026-11-16')
    expect(planSummary({ ...monthly, to: '2026-11-01' }, txs, '2026-11-10').nextDate).toBeNull()
    expect(planSummary(monthly, txs, '2026-11-10', 'EUR', false).rates).toHaveLength(2) // senza le rate a mano
  })
})

describe('rata eliminata dai movimenti', () => {
  it('si salta la data della sua chiave, o quella del piano vicina per le rate senza chiave', () => {
    const keyed = buildPacTx(monthly, '2026-10-16', { date: '2026-10-19', price: 20 }, () => 'k')
    expect(pacSkipsFor(keyed, [monthly], 'tr', 'a')).toEqual([{ planId: 'p1', date: '2026-10-16' }])
    const manual = { id: 'm', date: '2026-10-17', type: 'buy', qty: 1, price: 25, source: 'pac' }
    expect(pacSkipsFor(manual, [monthly, weekly], 'tr', 'a')).toEqual([{ planId: 'p1', date: '2026-10-16' }, { planId: 'p2', date: '2026-10-19' }])
    expect(pacSkipsFor({ ...manual, source: undefined }, [monthly], 'tr', 'a')).toEqual([])
    expect(pacSkipsFor(manual, [monthly], 'altro', 'a')).toEqual([])
  })
})
