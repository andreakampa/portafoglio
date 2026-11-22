import { useAuth, useUser } from '../auth/context'
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
      <PortfoliosCard />
      {isAdmin && <InvitesCard />}
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
