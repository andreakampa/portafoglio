// Tema dell'app: automatico (segue il dispositivo), chiaro o scuro. La scelta vale per questo dispositivo.

export type ThemePref = 'auto' | 'light' | 'dark'

const KEY = 'ptpro_theme'
const BAR = { light: '#1f2a2e', dark: '#0b1416' }

export function readTheme(): ThemePref {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : 'auto'
  } catch {
    return 'auto'
  }
}

/** Applica il tema alla pagina (attributo data-theme su <html>) e al colore della barra del telefono. */
export function applyTheme(pref: ThemePref = readTheme()): void {
  const root = document.documentElement
  if (pref === 'auto') delete root.dataset.theme
  else root.dataset.theme = pref
  const dark = pref === 'dark' || (pref === 'auto' && window.matchMedia?.('(prefers-color-scheme: dark)').matches)
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? BAR.dark : BAR.light)
}

export function saveTheme(pref: ThemePref): void {
  try {
    if (pref === 'auto') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, pref)
  } catch {
    /* storage non disponibile: vale fino alla chiusura */
  }
  applyTheme(pref)
}
