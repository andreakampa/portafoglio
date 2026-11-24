import { Link, NavLink, Outlet, useLocation } from 'react-router'
import { BonusRunner } from '../components/BonusRunner'
import { PacRunner } from '../components/PacRunner'
import { Toaster } from '../components/Toaster'
import { usingEmulator } from '../lib/firebase'
import { IconChat, IconHome, IconMore, IconMovements, IconNotes, IconPositions, IconSettings, IconSimulator, IconTax, IconWatch } from './icons'

type Item = { to: string; label: string; icon: () => React.JSX.Element; end?: boolean }

/** PC: barra laterale a gruppi (le cose di tutti i giorni, gli strumenti, le impostazioni). */
const GROUPS: Item[][] = [
  [
    { to: '/', label: 'Panoramica', icon: IconHome, end: true },
    { to: '/posizioni', label: 'Posizioni', icon: IconPositions },
    { to: '/movimenti', label: 'Movimenti', icon: IconMovements },
    { to: '/fiscale', label: 'Fiscale', icon: IconTax },
  ],
  [
    { to: '/simulatore', label: 'Simulatore', icon: IconSimulator },
    { to: '/watchlist', label: 'Watchlist', icon: IconWatch },
    { to: '/assistente', label: 'Assistente', icon: IconChat },
    { to: '/note', label: 'Note', icon: IconNotes },
  ],
  [{ to: '/impostazioni', label: 'Impostazioni', icon: IconSettings }],
]

/** Pagine che sul telefono stanno sotto "Altro": la voce resta evidenziata quando sei lì. */
const UNDER_MORE = ['/altro', '/movimenti', '/simulatore', '/watchlist', '/assistente', '/note', '/impostazioni']

// Telefono: barra in basso con 5 voci e il "+" al centro. PC (da 900px): barra laterale. Il CSS decide quale mostrare.
export function AppShell() {
  const { pathname } = useLocation()
  const moreActive = UNDER_MORE.some(p => pathname === p || pathname.startsWith(p + '/'))

  return (
    <div className="shell">
      <nav className="sidenav" aria-label="Sezioni">
        <div className="brand">
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" width={28} height={28} />
          <span>Portafoglio</span>
        </div>
        {GROUPS.map((g, i) => (
          <div key={i} className="nav-group">
            {g.map(({ to, label, icon: Icon, end }) => (
              <NavLink key={to} to={to} end={end} className="navlink">
                <Icon />
                <span>{label}</span>
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      <main className="content">
        {usingEmulator && <div className="banner">Emulatore attivo: dati di prova</div>}
        <PacRunner />
        <Toaster />
        <BonusRunner />
        <Outlet />
      </main>

      <nav className="tabbar" aria-label="Sezioni">
        <NavLink to="/" end className="tab"><IconHome /><span>Home</span></NavLink>
        <NavLink to="/posizioni" className="tab"><IconPositions /><span>Posizioni</span></NavLink>
        <Link to="/movimenti" state={{ nuovo: true }} className="tab tab-plus" aria-label="Nuovo movimento"><span className="plus" aria-hidden="true">+</span></Link>
        <NavLink to="/fiscale" className="tab"><IconTax /><span>Fiscale</span></NavLink>
        <NavLink to="/altro" className={() => `tab ${moreActive ? 'active' : ''}`}><IconMore /><span>Altro</span></NavLink>
      </nav>
    </div>
  )
}
