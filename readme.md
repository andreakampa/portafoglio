# Portafoglio Tracker Pro

Sito statico ospitato su GitHub Pages per il tracking del portafoglio azionario.
URL: https://andreakampa.github.io/portafoglio/

## Stack
- HTML + CSS + JavaScript vanilla (ES6 modules)
- Firebase Realtime Database (per salvare i dati)
- Yahoo Finance API via proxy (per i prezzi live)
- Nessun framework, nessun bundler

## Struttura file

### Root
- `index.html` → shell HTML: navbar, overlay auth (setup/login), container pagine, script entry point

### css/
- `base.css` → variabili CSS dark theme, reset, utility classes, spinner, skeleton loader
- `components.css` → bottoni, card, stat-card, tabelle, form, modali, toast, auth box, badge
- `layout.css` → navbar, main content, dashboard grid, responsive mobile

### js/
- `app.js` → entry point: inizializza Auth, Router, eventi navbar e logout

### js/core/
- `auth.js` → setup prima configurazione, login con SHA-256, sessione con sessionStorage
- `router.js` → SPA router hash-based (#portfolio, #settings), mount/destroy pagine
- `db.js` → load/save dati su Firebase Realtime Database (fetch REST)
- `cache.js` → cache prezzi in localStorage con TTL 8 minuti
- `toast.js` → notifiche toast (ok/err/info)

### js/api/
- `exchange.js` → fetch cambio EUR/USD da open.er-api.com, singleton
- `yahoo.js` → fetch prezzi live da Yahoo Finance con 2 proxy paralleli (allorigins + corsproxy)

### js/modules/portfolio/
- `index.js` → orchestratore: carica dati Firebase, aggiorna prezzi, gestisce stato, chiama render
- `calc.js` → calcoli puri: PMC da storico transazioni, P&L, after-tax (26% azioni, 12.5% BTP)
- `render.js` → rendering HTML tabella posizioni e KPI dashboard (stat cards)
- `ui.js` → modali: transazione (acquisto/vendita), storico transazioni, simulazione acquisto

### js/modules/settings/
- `index.js` → pagina impostazioni: modifica URL Firebase, cambio password, svuota cache

## Funzionalità implementate
- Setup iniziale con URL Firebase e password (SHA-256)
- Login con sessione persistente (sessionStorage)
- Aggiunta titoli con ticker Yahoo Finance (azioni, ETF, obbligazioni, crypto)
- Storico transazioni per ogni titolo (acquisto/vendita)
- Calcolo automatico PMC, P&L realizzato e non realizzato
- Tassazione automatica: 26% azioni/ETF, 12.5% titoli di stato
- Controvalore after-tax
- Prezzi live da Yahoo Finance con cache 8 min
- Cambio EUR/USD real-time
- Visualizzazione in EUR o USD
- Simulazione acquisto (nuovo PMC, azioni acquistabili con budget)
- Aggiornamento automatico prezzi ogni 5 minuti
- Responsive mobile

## Firebase
- Realtime Database
- Struttura dati: `/portafoglio/{id}` con campi:
  - `nome` (ticker), `valuta`, `tipoAsset`, `commDefault`, `transactions[]`
  - ogni transazione: `{ date, type, qty, price, commission }`

## Note future
- Per aggiungere una nuova pagina: creare `js/modules/nuovapagina/index.js` con `mount()` e `destroy()`, registrarla in `router.js` e aggiungere il link in `index.html`
- I calcoli fiscali sono in `calc.js` → modificare solo lì le aliquote
- I proxy Yahoo sono in `yahoo.js` array `PROXIES` → aggiungerne altri se smettono di funzionare
