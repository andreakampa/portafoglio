import { describe, expect, it } from 'vitest'
import { marginCallChangePct, parseChangePct, parseMaintPct, stressLevel, stressMargin, type StressBase } from './marginStress'

// Conto di esempio solo long: posizioni 100.000 €, prestito 35.000 €, mantenimento 26%.
const conto: StressBase = { grossEur: 100000, positionsEur: 100000, equityEur: 65000, maintPct: 26 }

describe('stress test del margine', () => {
  it('oggi: mantenimento e liquidità in eccesso come su IBKR', () => {
    const s = stressMargin(conto, 0)
    expect(s.equityEur).toBe(65000)
    expect(s.maintEur).toBe(26000)
    expect(s.excessEur).toBe(39000)
    expect(s.leverage).toBe(1.538)
  })

  it('un calo dei titoli pesa di più sul patrimonio netto per via della leva', () => {
    const s = stressMargin(conto, -10)
    expect(s.grossEur).toBe(90000)
    expect(s.equityEur).toBe(55000)
    expect(s.equityChangePct).toBe(-15.4)
    expect(s.leverage).toBe(1.636)
  })

  it('un rialzo abbassa la leva', () => {
    const s = stressMargin(conto, 20)
    expect(s.equityChangePct).toBe(30.8)
    expect(s.leverage).toBe(1.412)
  })

  it('margin call quando il netto arriva al mantenimento', () => {
    const x = marginCallChangePct(conto)!
    expect(x).toBe(-52.7)
    expect(stressMargin(conto, x - 0.1).excessEur).toBeLessThan(0)
    expect(stressMargin(conto, x + 0.1).excessEur).toBeGreaterThan(0)
  })

  it('con un mantenimento più basso la margin call arriva più tardi', () => {
    expect(marginCallChangePct({ ...conto, maintPct: 25 })).toBe(-53.3)
  })

  it('senza debito non c’è margin call possibile', () => {
    expect(marginCallChangePct({ grossEur: 10000, positionsEur: 10000, equityEur: 11000, maintPct: 25 })).toBeNull()
  })

  it('un conto già sotto il mantenimento è in margin call adesso', () => {
    expect(marginCallChangePct({ grossEur: 10000, positionsEur: 10000, equityEur: 2000, maintPct: 25 })).toBe(0)
  })

  it('con molti short la margin call arriva da un rialzo', () => {
    const b = { grossEur: 20000, positionsEur: -20000, equityEur: 10000, maintPct: 30 }
    const x = marginCallChangePct(b)!
    expect(x).toBeGreaterThan(0)
    expect(Math.abs(stressMargin(b, x).excessEur)).toBeLessThan(50) // x arrotondato a 0,1 punti
  })

  it('livelli: ok, attenzione sotto metà del cuscinetto di oggi, margin call', () => {
    expect(stressLevel(conto, stressMargin(conto, -10))).toBe('ok')
    expect(stressLevel(conto, stressMargin(conto, -35))).toBe('near')
    expect(stressLevel(conto, stressMargin(conto, -55))).toBe('call')
  })

  it('patrimonio azzerato: leva non calcolabile', () => {
    expect(stressMargin(conto, -70).leverage).toBeNull()
  })

  it('legge le percentuali scritte a mano', () => {
    expect(parseChangePct('-12,5')).toBe(-12.5)
    expect(parseChangePct('−30%')).toBe(-30)
    expect(parseChangePct('-150')).toBe(-99)
    expect(parseChangePct('abc')).toBeNull()
    expect(parseMaintPct('27,5')).toBe(27.5)
    expect(parseMaintPct('0')).toBeNull()
    expect(parseMaintPct('120')).toBeNull()
  })
})
