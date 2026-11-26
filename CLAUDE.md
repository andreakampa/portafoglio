# Portafoglio Tracker Pro — istruzioni per Claude

Stato del lavoro e cose da fare: **[docs/stato-progetto.md](docs/stato-progetto.md)** (leggilo per primo).
Regole fiscali applicate dal motore: [docs/regole-fiscali.md](docs/regole-fiscali.md).

## Come lavoriamo
- Rispondi in **italiano**, semplice: Andrea non è uno sviluppatore e vuole che tutto sia automatico (niente passi a mano se evitabili).
- **Mai committare senza test verdi.** Ogni modifica: branch → test → commit → PR → OK di Andrea → unione su `main`.
- Unire su `main` = pubblicare: GitHub Actions (`.github/workflows/pages.yml`) rifà test e build e pubblica su GitHub Pages
  il sito attuale (`/portafoglio/`). La v2 (Gruzzolo) è su
  https://miogruzzolo.pages.dev: Cloudflare Pages la ricompila da solo a ogni unione su main (`npm run build:gruzzolo`). Su questo repository l'auto-merge non è abilitato.
- **Dati veri su Firebase:** prima un backup (`firebase database:get / -o .backup/database-<data>.json`), poi modifiche
  solo con l'OK esplicito di Andrea. Mostra prima cosa cambierà.
- Mai mostrare secret (token IBKR, chiave dell'account di servizio): leggili da file e passali via stdin.

## Struttura
| Percorso | Cosa |
|---|---|
| `index.html`, `js/`, `css/` | sito attuale (JS vanilla), ancora usato per inserire movimenti |
| `app/` | v2: Vite + React + TypeScript + PWA. `src/domain/` motore puro con test, `src/pages/` schermate |
| `workers/finance-proxy` | proxy Yahoo/cambi + `/chat` Gemini (chiave dell'utente). Solo il sito pubblicato (in locale la v2 passa da `/__proxy` di Vite), limite al minuto per IP |
| `workers/ibkr-relay` | relay Flex IBKR per il browser |
| `workers/ibkr-sync` | cron giornaliero 06:00 UTC: report Flex → portafoglio IBKR su Firebase; cron ogni 15 min: soglie delle watchlist → notifiche push (secret su Cloudflare) |
| `database.rules.json`, `tests/rules.test.mjs` | regole Firebase (inviti monouso, membri, admin) e loro test |
| `tools/` | confronti e riconciliazioni sui dati del backup locale |
| `.backup/` | backup e report con dati personali: **escluso da git**, mai pubblicarlo |

## Comandi
```
cd app && npm run check          # tipi + linter + test unitari (obbligatorio prima di ogni commit)
npm run test:rules               # dalla radice: test regole Firebase sugli emulatori (serve Java)
npm run test:workers             # dalla radice: test dei Worker (origini e limite di richieste)
npx wrangler@4 deploy -c workers/<nome>/wrangler.jsonc
firebase deploy --only database  # pubblica le regole
```
Prove della v2 con dati finti: `firebase emulators:start --only auth,database`, poi su localhost
`localStorage.ptpro_emulator = '1'`. Per caricare una copia dei dati reali negli emulatori: leggere l'ultimo
`.backup/database-*.json` e scriverlo con `Authorization: Bearer owner` su `http://127.0.0.1:9000/...?ns=calcolo-pmc-default-rtdb`.

## Particolarità di questo PC (Windows)
- Node non è nel PATH della shell Bash: `export PATH="$PATH:/c/Program Files/nodejs"`.
  In PowerShell rinfrescare il PATH: `$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')`.
- La shell di Claude è isolata: i pacchetti npm globali installati da lì **non** si vedono nel terminale di Andrea
  (per login interattivi tipo `firebase login` usare il terminale del pannello).
- In Git Bash i percorsi tipo `/users/...` passati a `firebase` vengono storpiati: usare PowerShell.
- `firebase` e `wrangler` sono già autenticati sull'account di Andrea. Python non è installato.
- Il server di anteprima per il browser integrato è in `.claude/launch.json` (escluso da git).
