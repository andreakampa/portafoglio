import { Link } from 'react-router'
import { IconChat, IconMovements, IconNotes, IconSettings, IconSimulator, IconTax, IconWatch } from '../layout/icons'

const ITEMS = [
  { to: '/movimenti', label: 'Movimenti', hint: 'acquisti, vendite, cassa, PAC', icon: IconMovements },
  { to: '/simulatore', label: 'Simulatore', hint: 'prova prima di comprare o vendere', icon: IconSimulator },
  { to: '/watchlist', label: 'Watchlist', hint: 'titoli da seguire e avvisi', icon: IconWatch },
  { to: '/assistente', label: 'Assistente', hint: 'domande sul portafoglio', icon: IconChat },
  { to: '/note', label: 'Note', hint: 'idee, prossime mosse, eventi', icon: IconNotes },
  { to: '/fiscale/dichiarazione', label: 'Dichiarazione', hint: 'quadri RT, RM, RW', icon: IconTax },
  { to: '/impostazioni', label: 'Impostazioni', hint: 'tema, portafogli, inviti, account', icon: IconSettings },
]

/** Telefono: tutte le sezioni che non stanno nella barra in basso. */
export function More() {
  return (
    <section className="page">
      <header className="page-head"><h1>Altro</h1></header>
      <div className="more-grid">
        {ITEMS.map(({ to, label, hint, icon: Icon }) => (
          <Link key={to} to={to} className="card more-item">
            <Icon />
            <span><b>{label}</b><br /><small className="muted">{hint}</small></span>
          </Link>
        ))}
      </div>
    </section>
  )
}
