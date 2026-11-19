import { initializeApp } from 'firebase/app'
import { connectAuthEmulator, getAuth } from 'firebase/auth'
import { connectDatabaseEmulator, getDatabase } from 'firebase/database'

// Configurazione pubblica per natura: la protezione dei dati sta nelle regole del
// database (database.rules.json nella radice del repository).
const firebaseConfig = {
  apiKey: 'AIzaSyBQ3mSc6sH3dgwvpagi7yaQlDigqyFJRX4',
  authDomain: 'calcolo-pmc.firebaseapp.com',
  databaseURL: 'https://calcolo-pmc-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'calcolo-pmc',
}

// Prove in locale: con `firebase emulators:start --only auth,database` e, su localhost,
// localStorage.ptpro_emulator = '1', auth e database usano gli emulatori e non i dati veri.
function readEmulatorFlag(): boolean {
  if (!['localhost', '127.0.0.1'].includes(location.hostname)) return false
  try {
    return localStorage.getItem('ptpro_emulator') === '1'
  } catch {
    return false
  }
}

export const usingEmulator = readEmulatorFlag()

export const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const db = getDatabase(app)

if (usingEmulator) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  connectDatabaseEmulator(db, '127.0.0.1', 9000)
}
