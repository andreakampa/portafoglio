// Scelte del grafico "Andamento" della Panoramica (vista Valore/Performance e linee accese).
// Salvate su Firebase in users/{uid}/settings/historyChart: uguali su telefono e PC.
// Solo booleani e stringhe: Firebase scarta liste vuote e null, quindi niente array.

export type ChartView = 'value' | 'perf'

/** Linee che si possono accendere e spegnere (chiavi valide per Firebase: niente "^"). */
export const TOGGLES = [
  { key: 'gspc', symbol: '^GSPC', label: 'S&P 500', view: 'perf' },
  { key: 'ndx', symbol: '^NDX', label: 'Nasdaq 100', view: 'perf' },
  { key: 'invested', symbol: null, label: 'Capitale investito', view: 'value' },
] as const

export type ToggleKey = (typeof TOGGLES)[number]['key']

export interface HistoryChartPrefs {
  view: ChartView
  show: Record<ToggleKey, boolean>
}

/** Prima di qualsiasi scelta: vista Valore, tutte le linee accese (come il grafico di prima). */
export const DEFAULT_PREFS: HistoryChartPrefs = { view: 'value', show: { gspc: true, ndx: true, invested: true } }

/** Legge ciò che è salvato, ignorando valori sconosciuti o rovinati; quello che manca prende il valore di base. */
export function reconcileChartPrefs(saved: unknown): HistoryChartPrefs {
  const s = (saved && typeof saved === 'object' ? saved : {}) as { view?: unknown; show?: unknown }
  const show = (s.show && typeof s.show === 'object' ? s.show : {}) as Record<string, unknown>
  return {
    view: s.view === 'perf' || s.view === 'value' ? s.view : DEFAULT_PREFS.view,
    show: Object.fromEntries(
      TOGGLES.map(t => [t.key, typeof show[t.key] === 'boolean' ? show[t.key] : DEFAULT_PREFS.show[t.key]]),
    ) as Record<ToggleKey, boolean>,
  }
}

export const toggleLine = (p: HistoryChartPrefs, key: ToggleKey): HistoryChartPrefs => ({ ...p, show: { ...p.show, [key]: !p.show[key] } })

export const setView = (p: HistoryChartPrefs, view: ChartView): HistoryChartPrefs => ({ ...p, view })
