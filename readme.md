# Portafoglio Tracker Pro

Sito statico ospitato su GitHub Pages per il tracking del portafoglio azionario.
URL: https://andreakampa.github.io/portafoglio/

## Stack
- HTML + CSS + JavaScript vanilla (ES6 modules)
- Firebase Realtime Database (per salvare i dati)
- Yahoo Finance API via Cloudflare Worker proxy (per i prezzi live)
- Cambio EUR/USD via open.er-api.com
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
- `db.js` → load/save dati su Firebase Realtime Database (fetch REST con token JWT)
- `cache.js` → cache prezzi in localStorage con TTL 8 minuti
- `toast.js` → notifiche toast (ok/err/info)

### js/api/
- `exchange.js` → fetch cambio EUR/USD da open.er-api.com tramite Cloudflare Worker, singleton
- `yahoo.js` → fetch prezzi live da Yahoo Finance tramite Cloudflare Worker + allorigins.win come fallback
- `search.js` → ricerca ticker Yahoo Finance tramite Cloudflare Worker + allorigins.win come fallback

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
- Ricerca titoli con autocompletamento (nome, ticker, ISIN)
- Storico transazioni per ogni titolo (acquisto/vendita)
- Calcolo automatico PMC, P&L realizzato e non realizzato
- Tassazione automatica: 26% azioni/ETF, 12.5% titoli di stato
- Controvalore after-tax
- Prezzi live da Yahoo Finance con cache 8 min
- Cambio EUR/USD real-time
- Visualizzazione in EUR o USD
- Simulazione acquisto (nuovo PMC, azioni acquistabili con budget)
- Aggiornamento automatico prezzi ogni 5 minuti
- Loghi ticker con cascata multi-provider + fallback SVG generato
- Responsive mobile con card espandibili

## Firebase
- Realtime Database (Europe West 1)
- Autenticazione tramite Firebase Auth (email/password)
- Struttura dati: `/users/{uid}/portafoglio/{id}` con campi:
  - `nome` (ticker), `valuta`, `tipoAsset`, `commDefault`, `logoUrl`, `transactions[]`
  - ogni transazione: `{ date, type, qty, price, commission }`
- Regole di sicurezza:
{
  "rules": {
    "inviteCode": { ".read": true, ".write": false },
    "users": {
      "$uid": {
        ".read": "auth != null && auth.uid === $uid",
        ".write": "auth != null && auth.uid === $uid"
      }
    }
  }
}
## Cloudflare Worker
- URL: `https://finance-proxy.andrea-kampa.workers.dev`
- Funge da proxy CORS per Yahoo Finance e open.er-api.com
- Piano gratuito: 100.000 richieste/giorno
- Codice Worker:
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const target = url.searchParams.get('url');
    if (!target) return new Response('Missing url param', { status: 400 });
    const response = await fetch(target, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }
    });
    const body = await response.text();
    return new Response(body, {
      status: response.status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      }
    });
  }
};
## Note future
- Per aggiungere una nuova pagina: creare `js/modules/nuovapagina/index.js` con `mount()` e `destroy()`, registrarla in `router.js` e aggiungere il link in `index.html`
- I calcoli fiscali sono in `calc.js` → modificare solo lì le aliquote
- Il proxy Cloudflare è in `yahoo.js`, `exchange.js` e `search.js` → costante `PROXY` in cima ai file
- Se il Worker Cloudflare smette di funzionare, `allorigins.win` subentra automaticamente come fallback
- I loghi ticker usano cascata: financialmodelingprep → parqet → eodhd → SVG generato
