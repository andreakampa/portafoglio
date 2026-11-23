# Parità v2 con il sito vecchio — checklist

Creata il 23/11/2026 dopo la revisione di Andrea: la v2 (`app/`) ha migliorato motore fiscale, sincronizzazione IBKR e
molto altro, ma ha perso parecchie funzioni dell'interfaccia del sito vecchio (`index.html` + `js/`).

**Regole**
- **Il sito vecchio NON si dismette** finché questa checklist non è tutta spuntata (annulla la nota "dopo qualche giorno
  di uso si può dismettere il sito vecchio" in `stato-progetto.md`).
- Per ogni blocco: **mockup prima** (Andrea approva), poi branch → test → PR, come sempre.
- Prendere il comportamento dal codice vecchio indicato, non reinventarlo. Dove il vecchio usava il motore vecchio,
  usare i numeri del motore nuovo (`app/src/domain/engine/`).

---

## 0. Schema colori (approvato da Andrea il 23/11/2026) — ✅ fatto (PR `colori-telefono`)

Oggi `--primary` (verde acqua) è usato per tutto: menu, pulsanti, badge, short, chiusure short, esercizio, link.
Nuova regola: **un colore per significato, sempre con icona** (leggibile anche senza colore).

| Significato | Colore (tema sera) | Icona Tabler | Stile |
|---|---|---|---|
| Menu, selezione, pulsante principale | verde acqua `#2bb5a8` | — | **solo qui** |
| Guadagno / perdita (solo numeri) | `--pos` `#3ccf74` / `--neg` `#ff6b6d` | ▲ ▼ | invariato |
| Acquisto | blu `#8dbaff` su `rgba(91,157,255,.16)` | `ti-plus` | pieno |
| Vendita | arancio `#ffb873` su `rgba(255,159,67,.16)` | `ti-minus` | pieno |
| Short | viola `#c8adff` su `rgba(177,140,255,.18)` | `ti-trending-down` | pieno |
| Chiusura short | viola `#c8adff`, bordo `#8f6fd6` | `ti-arrow-back-up` | contornato |
| Trasferimento (entrata/uscita, "da Mediolanum") | ambra `#f0c96a` su `rgba(230,184,74,.16)` | `ti-arrows-exchange` | pieno |
| Dividendo | rosa `#ff9fc8` su `rgba(255,126,182,.16)` | `ti-coin` | pieno |
| Simula | azzurro `#7fd8ff` su `rgba(80,190,240,.16)` | `ti-flask` | pieno |
| Storico | neutro (testo) | `ti-history` | bordo |
| Modifica | giallo `#f2c94c` | `ti-pencil` | bordo |
| Elimina | rosso `#ff6b6d`, bordo `#5a2a2c` | `ti-x` | contornato |

- Stessi colori ovunque: badge in Movimenti (`.kind-*` in `index.css`), pulsanti sulla riga del titolo, intestazioni
  delle finestre (es. "Simula vendita" arancio), filtri.
- Badge generici (`.badge`): neutri, non più `color: var(--primary)`. "da confermare" e "margine" in ambra/avviso.
- Tema giorno: stessa logica con tinte più scure (contrasto ≥ 4,5:1).
- Icone: aggiungere `@tabler/icons-webfont` (o le SVG equivalenti) ospitate nell'app, come i font.
- Riferimento visivo: mockup "Proposta" mostrato ad Andrea nella chat del 23/11/2026.
- **Fatto:** etichette con icona in `components/Tag.tsx` (`Tag`, `TagButton`, `KIND_TONE`; icone SVG col disegno Tabler, niente
  webfont), colori come variabili `--buy`, `--sell`, `--short`… in `index.css`. Usate in Movimenti (tipi, dividendi, Modifica/Elimina),
  Note, short in Posizioni/Panoramica/Fiscale/Prospetto. Le stesse classi `tag-*` servono per i pulsanti del blocco 5.
- **Tema giorno (scelta A di Andrea, 23/11/2026):** il colore principale diventa verde acqua scuro `#0f6e66` anche di giorno
  (il blu profondo si confondeva con l'Acquisto). Esercizio di opzioni: etichetta neutra.

---

## 1. Telefono e layout

- [x] **Tabella Posizioni che esce a destra** tra 900 e ~1.100 px (barra laterale + 7 colonne): colonne Valore e
      Risultato tagliate. Mai scorrimento laterale nascosto: schede fino a quando la tabella non ci sta, o colonne che si riducono.
      Fatto: sotto i 1.300 px 5 colonne (quantità sotto il titolo, variazione sotto il prezzo; classi `col-wide`/`col-narrow`).
- [x] **Numeri dei riquadri (`Kpi`) che vanno a capo** ("-4478,90" / "€"): `white-space: nowrap` sul valore e
      dimensione che si adatta (`clamp()`).
- [x] Protezione "Sito desktop" di Chrome: decidere telefono/PC anche con `(pointer: coarse)` oltre alla larghezza.
      (Andrea aveva "Sito desktop" attivo: risolto reinstallando la PWA.)
      Fatto: barra laterale con `(min-width: 900px) and (pointer: fine), (min-width: 1200px)`.

## 2. Header / barra superiore (vecchio: `render.js`, `index.js`)

- [ ] Cambio EUR/USD in tempo reale visibile.
- [ ] **Mostra in: € EUR / $ USD** — interruttore che converte gli importi della tabella.
- [ ] **Peso su: Portafoglio / Tutti** (base dei % peso).
- [ ] Badge **Cassetto fiscale** con avviso (!), che apre il riepilogo tasse (vecchio: azione `tasse-dovute-dashboard`).
- [ ] Ora dell'ultimo aggiornamento prezzi + pulsante Aggiorna.

## 3. Numeri chiave (vecchio: 12, v2: 4)

Ripristinare, in due gruppi come nel vecchio:
- **Portafoglio:** Investito, Controvalore, Commissioni pagate, Interessi margine (totale addebitato), Dividendi
  (totale ricevuto, cliccabile → azione `dividendi-dashboard`), Tasse su plusvalenze (stimate anno corrente, cliccabile).
- **Performance:** P&L non realizzato (%), P&L after tax (% e tasse), P&L realizzato lordo, P&L realizzato netto,
  P&L totale after tax (realizzato netto + non realizzato netto), P&L EUR storico (cambio BCE/BdI storico).

## 4. Tabella Posizioni (vecchio: `COLUMN_DEFS` in `js/modules/portfolio/render.js`, gestione in `index.js` ~r. 890-920)

- [ ] **Colonne configurabili**: mostra/nascondi e riordina (pulsante ingranaggio), salvate per utente su Firebase.
      Colonne del vecchio: Symbol, Shares, AC/Share (PMC), Last Price, Open, Prev Close, Daily P&L, Total Cost,
      Market Value, % Costo, % Mercato, P&L Gross UNRL, P&L Net UNRL, P&L Gross REAL, P&L Net REAL, PMC EUR,
      Commissioni tot., Dividendi titolo, Trading tools.
- [ ] **Ordinamento cliccando l'intestazione** (crescente/decrescente, numeri e nomi), al posto del menu a tendina.
- [ ] Sotto il prezzo: variazione % del giorno + **barra 52 settimane** (min–max, segno colorato secondo la posizione).
- [ ] Sparkline intraday (vecchio: commento "Sparkline intraday minimale" in `render.js` ~r. 196).
- [ ] **Daily P&L in €** e %, non solo %.
- [ ] P&L non realizzato con **"di cui cambio"**; P&L netto con **tasse** della riga.
- [ ] Logo del titolo accanto al simbolo, badge valuta (USD, EUR, CAD…).
- [ ] **Pallino dividendi** accanto al simbolo (vecchio: `dividendoDot()` in `render.js` r. 233-251):
      verde = dividendi già pagati, arancione = maturato dopo lo stacco ma non ancora accreditato, entrambi se ci sono
      tutti e due; **cliccabile → finestra Dividendi del titolo**.
- [ ] **Gruppi** come nel vecchio (`groupedSortedIds`): Titoli attivi (n), Short, Chiuse, Vuote, Trasferiti — sezioni
      apribili/chiudibili.
- [ ] **Esporta** PDF / XLSX (vecchio: `js/modules/portfolio/export.js`).
- [ ] Schede telefono: stesse informazioni principali + pulsanti azione.

## 5. Azioni sulla riga del titolo ("Trading tools")

Vecchio: `data-action` = `history`, `buy`, `sell`, `short`, `cover`, `sim`, `transfer`, `dividendi`, `delete`.
Nella v2 le righe non sono cliccabili e tutto passa da Movimenti / Simulatore.

- [ ] Pulsanti sulla riga con i colori della sezione 0. Sul telefono: in un menu della scheda.
- [ ] Compra / Vendi / Short / Chiudi short → aprono il modulo movimento **già compilato** con titolo, valuta e
      quantità (MAX per vendite e chiusure).
- [ ] Simula → simulatore della v2 (più completo del vecchio) aperto sul titolo, in finestra, senza cambiare pagina.
      Mantenere le modalità del vecchio: Simula acquisto/vendita, **Per budget / Per quantità**, prezzo, commissioni.
- [ ] Trasferisci → finestra come la vecchia (`js/modules/portfolio/ui/transfer.js`): PMC attuale, q.tà disponibile,
      data, portafoglio destinazione, quantità (1–max), riepilogo (prezzo usato = PMC, commissioni, "trasferimento
      totale: il ticker verrà spostato in Titoli trasferiti"). Usa il `transferId` della v2.
- [ ] Elimina titolo (con conferma).

## 6. Finestra Storico del titolo (vecchio: `ui/history.js`)

- [ ] Selettore valuta, badge PAC.
- [ ] Riepilogo: Q.tà, PMC (€ e nativo), P&L realizzato, commissioni tot.
- [ ] Nota fiscale vs broker per i titoli in USD.
- [ ] Colonne: Data (ordinabile), Tipo (badge colorati + "lotto" sulle vendite), Q.tà, Prezzo (nativo + €),
      Comm., Totale, **Tasso €/USD**, PMC (€ + nativo), P&L lordo, P&L netto (fiscale, con tasse).
- [ ] Triangolo di avviso sulle righe anomale, modifica ed eliminazione per riga.

## 7. Finestra Dividendi del titolo (vecchio: `ui/dividendi.js`)

- [ ] Riquadri: Dividendi maturati (n, ultimo ex-date), Totale pagato (€ e $), Ultimo pagamento.
- [ ] Tabella: Ex-date, Pagamento, Stato (Maturato / Pagato), Div/azione, Quantità, Importo totale, Importo €,
      Netto atteso, **Netto reale inseribile a mano** con avviso anomalia oltre il 3% (logica già in `current-work`).

## 8. Posizioni chiuse

Oggi: solo simbolo + realizzato. Ripristinare le stesse colonne della tabella (realizzato lordo/netto, tasse,
commissioni, dividendi incassati, date di apertura/chiusura) e l'accesso allo storico del titolo.

## 9. Cassetto fiscale (da verificare con Andrea che la v2 copra tutto)

Vecchio: pannello laterale con schede **Tasse dovute** / **Minusvalenze**; riepilogo anno (Plus lorde, Minus generate,
Compensato, Imponibile netto, Tassa dovuta); una riga per vendita con badge Plus/Minus, data, importo e tassa;
nota sul metodo (FIFO minus entro 4 anni, aliquote, fondi non compensabili). Inserimento manuale di minus esterne.

---

## Funzioni del vecchio ancora da inventariare
Prima di dichiarare la parità, scorrere anche: `ui/cart.js` (carrello simulazioni), `ui/pac.js`, `ui/storico.js`,
`ui/transactions.js` (validazioni, MAX, anteprima live), `ui/ibkr.js`, `ui/ai.js`, `settings/index.js`, toast.
Per ognuna: c'è nella v2? Se no, aggiungerla qui.