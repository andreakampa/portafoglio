import { NavLink, Outlet } from 'react-router'
import { usingEmulator } from '../lib/firebase'
import { IconHome, IconMovements, IconNotes, IconPositions, IconSettings, IconTax } from './icons'

const NAV = [
  { to: '/', label: 'Panoramica', icon: IconHome, end: true },
  { to: '/posizioni', label: 'Posizioni', icon: IconPositions },
  { to: '/movimenti', label: 'Movimenti', icon: IconMovements },
  { to: '/fiscale', label: 'Fiscale', icon: IconTax },
  { to: '/note', label: 'Note', icon: IconNotes },
  { to: '/impostazioni', label: 'Impostazioni', icon: IconSettings },
] as const

// Telefono: barra in basso. PC (da 900px): barra laterale. Il CSS decide quale mostrare.
export function AppShell() {
  return (
    <div className="shell">
      <nav className="sidenav" aria-label="Sezioni">
        <div className="brand">
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" width={28} height={28} />
          <span>Portafoglio</span>
        </div>
        {NAV.map(({ to, label, icon: Icon, ...rest }) => (
          <NavLink key={to} to={to} end={'end' in rest} className="navlink">
            <Icon />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>

      <main className="content">
        {usingEmulator && <div className="banner">Emulatore attivo: dati di prova</div>}
        <Outlet />
      </main>

      <nav className="tabbar" aria-label="Sezioni">
        {NAV.map(({ to, label, icon: Icon, ...rest }) => (
          <NavLink key={to} to={to} end={'end' in rest} className="tab">
            <Icon />
            <span>{label === 'Impostazioni' ? 'Altro' : label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
