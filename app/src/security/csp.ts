// Content Security Policy della v2: l'elenco dei soli siti con cui la pagina può parlare.
// Se un giorno finisse nella pagina del codice estraneo, il browser non lo farebbe girare
// e non gli lascerebbe spedire dati altrove. GitHub Pages non permette di impostare
// intestazioni HTTP, quindi la regola va in un <meta> aggiunto da vite.config.ts solo alla
// build (in sviluppo Vite ha bisogno di script in linea per il ricaricamento a caldo).
//
// Quando si aggiunge una nuova fonte (un'API, un sito di immagini) va aggiunta qui,
// altrimenti il browser la blocca e nella console compare "Refused to ...".

/** Database Firebase (calcolo-pmc-default-rtdb): il server può spostare la connessione su altri nodi della stessa regione. */
const FIREBASE_DB_NODES = '*.europe-west1.firebasedatabase.app'

/** Emulatori Firebase (`firebase emulators:start`), usati solo su localhost con ptpro_emulator = '1'. */
const EMULATORS = ['http://127.0.0.1:9099', 'http://127.0.0.1:9000', 'ws://127.0.0.1:9000']

export const CSP_DIRECTIVES: Record<string, string[]> = {
  'default-src': ["'self'"],
  // Solo il codice dell'app: niente script in linea, niente eval, niente script da altri siti.
  // Unica eccezione: se il WebSocket è bloccato (alcune reti), Firebase ripiega su richieste
  // "long polling" caricate come script dai server del database.
  'script-src': ["'self'", `https://${FIREBASE_DB_NODES}`, 'http://127.0.0.1:9000'],
  'style-src': ["'self'"],
  'font-src': ["'self'"],
  // Loghi dei titoli (components/TickerLogo.tsx); data:/blob: per immagini generate nella pagina.
  'img-src': ["'self'", 'data:', 'blob:', 'https://financialmodelingprep.com', 'https://assets.parqet.com', 'https://eodhd.com'],
  'connect-src': [
    "'self'",
    // Proxy Cloudflare (lib/proxy.ts): prezzi, cambi, Banca d'Italia, assistente.
    'https://finance-proxy.andrea-kampa.workers.dev',
    // Firebase: login e rinnovo del token, poi database in tempo reale.
    'https://identitytoolkit.googleapis.com',
    'https://securetoken.googleapis.com',
    `https://${FIREBASE_DB_NODES}`,
    `wss://${FIREBASE_DB_NODES}`,
    ...EMULATORS,
  ],
  // Firebase Auth può usare una pagina nascosta del suo dominio; nient'altro va incorporato.
  'frame-src': ['https://calcolo-pmc.firebaseapp.com'],
  'worker-src': ["'self'"],
  'manifest-src': ["'self'"],
  'object-src': ["'none'"],
  'base-uri': ["'self'"],
  'form-action': ["'self'"],
}

export function buildCsp(directives: Record<string, string[]> = CSP_DIRECTIVES): string {
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(' ')}`)
    .join('; ')
}
