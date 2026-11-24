import { useAuth, useUser } from '../auth/context'
import { useState } from 'react'
import { Link } from 'react-router'
import { readTheme, saveTheme, type ThemePref } from '../lib/theme'
import { CacheCard, PasswordCard } from '../components/AccountCards'
import { InvitesCard, PortfoliosCard } from '../components/PortfolioAdmin'

export function Settings() {
  const { signOut } = useAuth()
  const { user, isAdmin } = useUser()

  return (
    <section className="page">
      <header className="page-head">
        <h1>Impostazioni</h1>
      </header>
      <div className="card">
        <h2>Account</h2>
        <p>
          {user.email}
          {isAdmin && <span className="badge">admin</span>}
        </p>
        <button className="btn btn-danger" type="button" onClick={() => void signOut()}>
          Esci
        </button>
      </div>
      <PasswordCard />
      <ThemeCard />
      <div className="card">
        <h2>Strumenti</h2>
        <div className="form-actions">
          <Link className="btn btn-ghost" to="/watchlist">Watchlist e avvisi</Link>
          <Link className="btn btn-ghost" to="/assistente">Assistente AI</Link>
          <Link className="btn btn-ghost" to="/fiscale/dichiarazione">Dichiarazione dei redditi</Link>
        </div>
      </div>
      <PortfoliosCard />
      {isAdmin && <InvitesCard />}
      <CacheCard />
      <div className="card">
        <h2>Versione</h2>
        <p className="muted">
          Nuova app {__APP_VERSION__}.
        </p>
        <a className="btn btn-ghost" href="/portafoglio/#settings">
          Impostazioni del sito attuale
        </a>
      </div>
    </section>
  )
}

const THEMES: { key: ThemePref; label: string; hint: string }[] = [
  { key: 'auto', label: 'Automatico', hint: 'chiaro di giorno, scuro quando lo è il telefono o il PC' },
  { key: 'light', label: 'Chiaro', hint: 'carta e inchiostro' },
  { key: 'dark', label: 'Scuro', hint: 'ardesia e verde acqua' },
]

/** Tema: vale per questo dispositivo. */
function ThemeCard() {
  const [pref, setPref] = useState<ThemePref>(readTheme)
  return (
    <div className="card">
      <h2>Tema</h2>
      <div className="pills" role="radiogroup" aria-label="Tema">
        {THEMES.map(t => (
          <button key={t.key} type="button" role="radio" aria-checked={pref === t.key} className={`pill ${pref === t.key ? 'active' : ''}`} onClick={() => { saveTheme(t.key); setPref(t.key) }}>
            {t.label}
          </button>
        ))}
      </div>
      <p className="muted small">{THEMES.find(t => t.key === pref)!.hint}. La scelta vale per questo dispositivo.</p>
    </div>
  )
}
