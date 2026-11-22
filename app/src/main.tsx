import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Caratteri dentro l'app (niente Google Fonts): funzionano anche offline.
import '@fontsource-variable/inter'
import '@fontsource/source-serif-4/600.css'
import '@fontsource/source-serif-4/700.css'
import './index.css'
import App from './App.tsx'
import { applyTheme } from './lib/theme.ts'

// Prima del disegno, così non si vede il lampo del tema sbagliato.
applyTheme()
window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => applyTheme())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
