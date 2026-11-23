import { describe, expect, it } from 'vitest'
import type { FiscalLine } from './engine/fiscal.ts'
import type { PositionResult } from './engine/positions.ts'
import type { RawAsset } from './engine/types.ts'
import type { PositionRow } from './engine/valuation.ts'
import { COLUMNS, groupRows, moveColumn, reconcileColumns, rowFigures, sortRows, toggleColumn, visibleColumns } from './positionTable.ts'

const row = (p: Partial<PositionRow>): PositionRow => ({
  assetId: 'a', symbol: 'A', currency: 'USD', qty: 10, isShort: false, pmcNative: 10, costEur: 100, costTodayFxEur: 90, price: 12,
  valueEur: 110, unrealizedEur: 10, unrealizedPct: 10, dayChangePct: 10, realizedEur: 0, ...p,
})

describe('colonne', () => {
  it('di partenza: le colonne di dettaglio sono nascoste', () => {
    const cfg = reconcileColumns(null)
    expect(cfg.order).toHaveLength(COLUMNS.length)
    expect(visibleColumns(cfg)).toEqual(['pmc', 'price', 'day', 'value', 'weightValue', 'unrealized'])
  })
  it('config salvata: tiene ordine e scelte, toglie colonne sconosciute, aggiunge le nuove nascoste', () => {
    const cfg = reconcileColumns({ order: ['value', 'pmc', 'vecchia' as never, 'value'], hidden: ['pmc'] })
    expect(cfg.order.slice(0, 2)).toEqual(['value', 'pmc'])
    expect(cfg.order).toHaveLength(COLUMNS.length)
    expect(cfg.hidden).toContain('pmc')
    expect(cfg.hidden).toContain('commissions')
    expect(cfg.hidden).not.toContain('price')
  })
  it('sposta e mostra/nasconde', () => {
    const cfg = { order: ['pmc', 'price', 'value'] as const, hidden: [] }
    expect(moveColumn({ order: [...cfg.order], hidden: [] }, 'price', -1).order).toEqual(['price', 'pmc', 'value'])
    expect(moveColumn({ order: [...cfg.order], hidden: [] }, 'pmc', -1).order).toEqual(['pmc', 'price', 'value'])
    expect(toggleColumn({ order: [...cfg.order], hidden: [] }, 'pmc').hidden).toEqual(['pmc'])
    expect(toggleColumn({ order: [...cfg.order], hidden: ['pmc'] }, 'pmc').hidden).toEqual([])
  })
})

describe('rowFigures', () => {
  const lines = [{ assetId: 'a', taxEur: 5 } as FiscalLine, { assetId: 'b', taxEur: 99 } as FiscalLine]
  it('oggi in euro, effetto cambio, imposta della riga, realizzato netto', () => {
    const f = rowFigures(row({ realizedEur: 30 }), { tipoAsset: 'stock' }, { commissionsEur: 3, pmcEur: 9 } as PositionResult, lines, 11)
    expect(f.dayEur).toBeCloseTo(10) // 110 oggi, 100 ieri
    // risultato fiscale 10, al cambio di oggi 110-90 = 20 → il cambio ha tolto 10
    expect(f.fxEffectEur).toBeCloseTo(-10)
    expect(f.taxEur).toBeCloseTo(2.6)
    expect(f.unrealizedNetEur).toBeCloseTo(7.4)
    expect(f.realizedNetEur).toBe(25)
    expect(f.commissionsEur).toBe(3)
    expect(f.prevClose).toBe(11)
  })
  it('titolo in euro: niente effetto cambio; in perdita: niente imposta; titoli di Stato 12,5%', () => {
    expect(rowFigures(row({ currency: 'EUR' }), undefined, undefined, [], null).fxEffectEur).toBeNull()
    expect(rowFigures(row({ unrealizedEur: -5 }), undefined, undefined, [], null).taxEur).toBe(0)
    expect(rowFigures(row({}), { tipoAsset: 'bond' }, undefined, [], null).taxEur).toBeCloseTo(1.25)
  })
  it('short: guadagno se il prezzo scende', () => {
    // vale 90 oggi, ieri 100 (dayChangePct +10 = guadagno per lo short)
    const f = rowFigures(row({ qty: -5, isShort: true, valueEur: -90, dayChangePct: 10 }), undefined, undefined, [], null)
    expect(f.dayEur).toBeCloseTo(10)
  })
})

describe('gruppi', () => {
  const tx = (type: string, qty = 1, extra = {}) => ({ type, qty, date: '2026-01-01', price: 1, ...extra })
  const assets: Record<string, RawAsset> = {
    a: { transactions: [tx('buy')] } as RawAsset,
    s: { transactions: [tx('short_sell')] } as RawAsset,
    c: { transactions: [tx('buy'), tx('sell')] } as RawAsset,
    e: { transactions: [] } as RawAsset,
    t: { transactions: [tx('buy', 2), tx('transfer', 2)] } as RawAsset,
    p: { transactions: [tx('buy', 3), tx('transfer', 1)] } as RawAsset,
    i: { transactions: [tx('transfer', 2, { sourcePortfolioId: 'x' })] } as RawAsset,
  }
  it('come il sito vecchio: parziali in attivi e trasferiti, entrate da trasferimento negli attivi', () => {
    const g = groupRows(
      [row({ assetId: 'a' }), row({ assetId: 's', qty: -1, isShort: true }), row({ assetId: 'c', qty: 0 }), row({ assetId: 'e', qty: 0 }),
        row({ assetId: 't', qty: 0 }), row({ assetId: 'p', qty: 2 }), row({ assetId: 'i', qty: 2 })],
      assets,
    )
    const ids = (k: keyof typeof g) => g[k].map(r => r.assetId)
    expect(ids('active')).toEqual(['a', 'p', 'i'])
    expect(ids('short')).toEqual(['s'])
    expect(ids('closed')).toEqual(['c'])
    expect(ids('empty')).toEqual(['e'])
    expect(ids('transferred')).toEqual(['t', 'p'])
  })
})

describe('ordinamento', () => {
  const items = [
    { r: row({ assetId: 'x', symbol: 'Zeta', unrealizedEur: 5 }), f: {} as never },
    { r: row({ assetId: 'y', symbol: 'alfa', unrealizedEur: null }), f: {} as never },
    { r: row({ assetId: 'z', symbol: 'Beta', unrealizedEur: -3 }), f: {} as never },
  ]
  it('numeri in su e in giù, valori mancanti sempre in fondo', () => {
    expect(sortRows(items, { key: 'unrealized', dir: 'desc' }).map(i => i.r.assetId)).toEqual(['x', 'z', 'y'])
    expect(sortRows(items, { key: 'unrealized', dir: 'asc' }).map(i => i.r.assetId)).toEqual(['z', 'x', 'y'])
  })
  it('nomi senza badare alle maiuscole', () => {
    expect(sortRows(items, { key: 'name', dir: 'asc' }).map(i => i.r.symbol)).toEqual(['alfa', 'Beta', 'Zeta'])
  })
})
