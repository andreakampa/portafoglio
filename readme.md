# Portafoglio Tracker Pro

Web app per il monitoraggio di uno o più portafogli di investimento (azioni, ETF, obbligazioni, crypto),
con calcolo del prezzo medio di carico, plus/minusvalenze e fiscalità italiana.

- Sito statico ospitato su GitHub Pages: https://andreakampa.github.io/portafoglio/
- Accesso riservato: account Firebase, registrazione solo con codice invito

## Stack

- HTML + CSS + JavaScript vanilla (moduli ES6), nessun framework, nessun bundler
- **Firebase Auth** (email/password) e **Firebase Realtime Database** (REST + streaming SSE)
- **Cloudflare Worker** (`finance-proxy.andrea-kampa.workers.dev`) come ponte verso Yahoo Finance, Gemini e IBKR
- **Yahoo Finance** per prezzi, ricerca titoli e dividendi
- **open.er-api.com** per il cambio attuale, **Banca d'Italia** per i cambi storici
- **Google Gemini** per l'assistente AI (chiave API dell'utente, salvata solo nel suo browser)
- **jsPDF + jspdf-autotable + SheetJS** (da CDN) per l'export PDF/Excel

## Avvio in locale

Non serve build. Basta servire la cartella con un server statico (i moduli ES6 non funzionano da `file://`):

```
npx serve .
```

oppure l'estensione *Live Server* di VS Code.

## Struttura

```
index.html              shell: overlay di login, navbar, contenitore pagine, script CDN
css/
  base.css              variabili tema, reset, utility, spinner, skeleton
  components.css        bottoni, card, tabelle, form, modali, toast, badge
  layout.css            navbar, griglia dashboard, responsive mobile
  cart.css              pannello carrello
js/
  app.js                entry point: login → router → eventi navbar/logout
  core/
    auth.js             Firebase Auth: login, registrazione con codice invito, logout
    router.js           router SPA a hash (#portfolio, #settings); pagine con mount()/destroy()
    db.js               load/save/watch su Realtime Database (REST con token, SSE per il tempo reale)
    cache.js            cache prezzi in localStorage (TTL 8 min)
    toast.js            notifiche
  api/
    config.js           costante PROXY (URL del Worker), unica fonte
    yahoo.js            prezzi live, pre/post market, apertura, minimi/massimi 52 settimane
    search.js           ricerca titoli (nome, ticker, ISIN)
    exchange.js         cambio EUR/USD attuale e storico (Banca d'Italia), con cache
    dividendi.js        storico e stima dividendi da Yahoo
    fiscale.js          cassetto fiscale: minusvalenze compensabili per anno e categoria
  modules/
    settings/index.js   cambio password, svuota cache
    portfolio/
      index.js          orchestratore della pagina: stato, caricamento, salvataggio, refresh,
                        selettore multi-portafoglio, configurazione colonne, blocco anti-conflitto
      calc.js           calcoli puri: PMC, P&L, tasse, regime amministrato/dichiarativo,
                        short, trasferimenti, compensazione minusvalenze
      render.js         KPI, tabella posizioni (ordinabile, colonne configurabili), card mobile, loghi
      export.js         export PDF/XLSX
      ui.js             barrel che riesporta le modali
      ui-sim-legacy.js  simulazione di acquisto/vendita (in uso)
      ibkr-flex.js          parser XML del report Flex IBKR
      ibkr-flex-client.js   download del report tramite relay
      ibkr-import.js        piano di import, applicazione, id dei movimenti
      ui/
        transactions.js movimenti: acquisto, vendita, short sell, buy to cover
        history.js      storico per titolo, lotti, valuta del titolo, cambio storico
        storico.js      movimenti di tutto il portafoglio (compravendite e dividendi), export
        transfer.js     trasferimento di un titolo tra portafogli
        pac.js          piani di accumulo con generazione automatica delle rate
        dividendi.js    dividendi per titolo/portafoglio, netto accreditato
        cart.js         carrello di acquisti simulati, per portafoglio
        sim-core.js     logica di simulazione condivisa
        ai.js           assistente AI (Gemini) con analisi del portafoglio
        ibkr.js         collegamento IBKR: impostazioni, sync giornaliero, revisione e annullamento import
        helpers.js      utility condivise
favicon/                icone e web manifest
```

## Funzionalità

- Login/registrazione Firebase con codice invito
- **Multi-portafoglio**: creazione, cambio, regime fiscale per portafoglio (amministrato/dichiarativo)
- Aggiunta titoli con ricerca e autocompletamento (nome, ticker, ISIN)
- Movimenti: acquisto, vendita, short sell, buy to cover, trasferimento tra portafogli
- Calcolo PMC, P&L realizzato e non realizzato, controvalore after-tax
- Fiscalità: 26% azioni/ETF, 12,5% titoli di stato, 33% crypto;
  minusvalenze compensabili per 4 anni, separate per categoria (cassetto fiscale)
- Cambio storico alla data del movimento (Banca d'Italia) per i titoli in valuta
- Prezzi live con pre/post market e range 52 settimane, refresh automatico ogni 5 minuti
- Visualizzazione in EUR o USD; pesi sul portafoglio attivo o su tutti i portafogli
- PAC con generazione automatica delle rate
- Dividendi: storico, stima, netto realmente accreditato
- Carrello di acquisti simulati e simulazione PMC
- Tabella con colonne riordinabili/nascondibili (salvate su Firebase), card espandibili su mobile
- Export PDF ed Excel di posizioni e movimenti
- Assistente AI (Gemini) per analisi del portafoglio, con cache di 1 ora
- Import automatico da IBKR (Flex Query): revisione prima dell'applicazione, backup e annullamento
- Sincronizzazione in tempo reale: se i dati cambiano da un altro dispositivo, la pagina si blocca
  e chiede di ricaricare, per evitare sovrascritture

## Firebase

Realtime Database (Europe West 1). Dati per utente sotto `/users/{uid}/`:

| Percorso | Contenuto |
|---|---|
| `portfolio_state` | `{ activePortfolioId, portfolios: { [id]: { id, name, taxRegime, assets, fiscal, marginInterest } } }` |
| `column_config` | `{ order: [...], hidden: [...] }` |
| `ibkr_config` | token, Query ID e portafoglio di destinazione per l'import IBKR |
| `ibkr_backup_ultimo_import` | copia dello stato prima dell'ultimo import IBKR |
| `backup_prima_migrazione_id` | copia di sicurezza prima dell'assegnazione degli id ai movimenti |
| `portafoglio` | formato legacy (singolo portafoglio), migrato automaticamente |

Ogni asset: `nome` (ticker), `valuta`, `tipoAsset` (`stock`/`bond`/`crypto`…), `commDefault`, `logoUrl`,
`pac`, `transactions[]`. Ogni movimento: `{ id, date, type, qty, price, commission, ... }`.

Regole di sicurezza:

```json
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
```

## Cloudflare Worker

Il codice dei Worker è in `workers/` (piano gratuito, 100.000 richieste/giorno).
Entrambi rispondono solo a `https://andreakampa.github.io` e a `localhost` (per le prove).

**`workers/finance-proxy`** → `https://finance-proxy.andrea-kampa.workers.dev`
- `?url=<indirizzo>` → proxy CORS, solo verso i domini in `ALLOWED_HOSTS`
  (Yahoo Finance, open.er-api.com, Banca d'Italia); se non risponde il sito usa `api.allorigins.win`
- `/chat` → inoltra a Gemini la domanda con la chiave dell'utente (header `X-Gemini-Key`), senza conservarla.
  Il Worker non ha una chiave propria: ogni utente usa la sua

**`workers/ibkr-relay`** → `https://ibkr-relay.andrea-kampa.workers.dev` (`/send`, `/get`):
scarica il report Flex (limiti IBKR: 1 richiesta/s, 10/min per token). Non salva nulla.

Pubblicazione (serve Node.js e un login una tantum con `npx wrangler@4 login`):

```
npx wrangler@4 deploy -c workers/finance-proxy/wrangler.jsonc
```

Per un nuovo dominio del sito: aggiungerlo ad `ALLOWED_ORIGINS` in entrambi i Worker e ripubblicarli.

## Note per lo sviluppo

- Nuova pagina: creare `js/modules/<nome>/index.js` con una classe che espone `mount()` e `destroy()`,
  registrarla in `router.js` e aggiungere il link in `index.html`
- Aliquote e logica fiscale: `calc.js` e `api/fiscale.js`
- URL del Worker: solo in `api/config.js` (costante `PROXY`), importato da tutti i moduli
- Dati esterni (Yahoo, IBKR, nomi inseriti) in `innerHTML`: sempre con `escapeHtml` di `ui/helpers.js`
- Loghi: cascata financialmodelingprep → parqet → eodhd → SVG generato
