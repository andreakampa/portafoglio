import { createHashRouter, RouterProvider } from 'react-router'
import { AuthProvider } from './auth/AuthContext'
import { useAuth } from './auth/context'
import { LoginScreen } from './auth/LoginScreen'
import { AppShell } from './layout/AppShell'
import { Fiscal } from './pages/Fiscal'
import { Movements } from './pages/Movements'
import { Notes } from './pages/Notes'
import { Overview } from './pages/Overview'
import { Placeholder } from './pages/Placeholder'
import { Positions } from './pages/Positions'
import { Settings } from './pages/Settings'
import { Simulator } from './pages/Simulator'
import { TaxReturn } from './pages/TaxReturn'
import { Watchlist } from './pages/Watchlist'
import { Assistant } from './pages/Assistant'

// Hash router: su GitHub Pages ogni indirizzo funziona anche ricaricando la pagina.
const router = createHashRouter([
  {
    element: <AppShell />,
    children: [
      { index: true, element: <Overview /> },
      { path: 'posizioni', element: <Positions /> },
      { path: 'movimenti', element: <Movements /> },
      { path: 'simulatore', element: <Simulator /> },
      { path: 'fiscale', element: <Fiscal /> },
      { path: 'fiscale/dichiarazione', element: <TaxReturn /> },
      { path: 'note', element: <Notes /> },
      { path: 'watchlist', element: <Watchlist /> },
      { path: 'assistente', element: <Assistant /> },
      { path: 'impostazioni', element: <Settings /> },
      { path: '*', element: <Placeholder title="Pagina non trovata" what="Questo indirizzo non esiste." /> },
    ],
  },
])

function Gate() {
  const { state } = useAuth()
  switch (state.status) {
    case 'loading':
      return <div className="splash" aria-busy="true" />
    case 'signedOut':
      return <LoginScreen />
    case 'needsInvite':
      return <LoginScreen mode="claim" />
    case 'ready':
      return <RouterProvider router={router} />
  }
}

export default function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  )
}
