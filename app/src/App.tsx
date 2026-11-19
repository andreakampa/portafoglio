import { createHashRouter, RouterProvider } from 'react-router'
import { AuthProvider } from './auth/AuthContext'
import { useAuth } from './auth/context'
import { LoginScreen } from './auth/LoginScreen'
import { AppShell } from './layout/AppShell'
import { Fiscal } from './pages/Fiscal'
import { Overview } from './pages/Overview'
import { Placeholder } from './pages/Placeholder'
import { Positions } from './pages/Positions'
import { Settings } from './pages/Settings'

// Hash router: su GitHub Pages ogni indirizzo funziona anche ricaricando la pagina.
const router = createHashRouter([
  {
    element: <AppShell />,
    children: [
      { index: true, element: <Overview /> },
      { path: 'posizioni', element: <Positions /> },
      { path: 'movimenti', element: <Placeholder title="Movimenti" what="Compravendite, dividendi e interessi, con prezzo di negoziazione e filtri." /> },
      { path: 'fiscale', element: <Fiscal /> },
      { path: 'note', element: <Placeholder title="Note" what="Idee, prossime mosse, titoli da seguire e date delle trimestrali." /> },
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
