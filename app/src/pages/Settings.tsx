import { useAuth, useUser } from '../auth/context'

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
      <div className="card">
        <h2>Versione</h2>
        <p className="muted">
          Nuova app {__APP_VERSION__}. La gestione inviti e le altre impostazioni sono ancora nel sito attuale.
        </p>
        <a className="btn btn-ghost" href="/portafoglio/#settings">
          Impostazioni del sito attuale
        </a>
      </div>
    </section>
  )
}
