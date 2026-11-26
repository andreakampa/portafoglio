import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFS, reconcileChartPrefs, setView, toggleLine } from './historyChart'

describe('preferenze del grafico Andamento', () => {
  it('senza nulla di salvato: vista Valore e tutte le linee accese', () => {
    expect(reconcileChartPrefs(null)).toEqual(DEFAULT_PREFS)
    expect(reconcileChartPrefs(undefined)).toEqual(DEFAULT_PREFS)
    expect(reconcileChartPrefs('rotto')).toEqual(DEFAULT_PREFS)
  })

  it('ricorda la vista e le linee spente', () => {
    expect(reconcileChartPrefs({ view: 'perf', show: { gspc: false, ndx: true, invested: false } })).toEqual({
      view: 'perf',
      show: { gspc: false, ndx: true, invested: false, margin: false },
    })
  })

  it('valori sconosciuti o mancanti prendono il valore di base', () => {
    expect(reconcileChartPrefs({ view: 'boh', show: { gspc: 'no', altro: true } })).toEqual(DEFAULT_PREFS)
    expect(reconcileChartPrefs({ show: { ndx: false } }).show).toEqual({ gspc: true, ndx: false, invested: true, margin: false })
  })

  it('accende e spegne una linea e cambia vista senza toccare il resto', () => {
    const p = toggleLine(DEFAULT_PREFS, 'gspc')
    expect(p.show).toEqual({ gspc: false, ndx: true, invested: true, margin: false })
    expect(toggleLine(p, 'gspc').show.gspc).toBe(true)
    expect(setView(p, 'perf')).toEqual({ view: 'perf', show: p.show })
    expect(DEFAULT_PREFS.show.gspc).toBe(true)
    expect(DEFAULT_PREFS.show.margin).toBe(false) // i totali col prestito partono spenti
  })
})
