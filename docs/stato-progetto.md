# Stato del progetto — aggiornato al 21/11/2026

## Obiettivo
Un'app (PWA, telefono e PC) per seguire più portafogli (IBKR dichiarativo, Mediolanum e Trade Republic
amministrati), con prezzo medio di carico, simulazioni di acquisto/vendita, cassetto fiscale corretto secondo
le regole italiane, note, margine e grafici. Da passare in futuro ad amici e parenti (multiutente con inviti).

## Fatto
- **Sicurezza**
  - Proxy Cloudflare limitato a Yahoo, cambi e Banca d'Italia e alle sole richieste dal sito.
  - Regole Firebase con inviti monouso, membri e admin (38 test).
  - Codice dei Worker nel repository.
- **v2 online** su `/portafoglio/v2/`
  - Login, registrazione con invito, PWA che si aggiorna da sola.
  - **Posizioni:** valore, PMC e risultato, con schede su telefono e tabella su PC.
  - **Fiscale:** plus e minus per anno, minus disponibili con scadenza, bollo e IVAFE stimati.
  - **Inserimento e modifica dei movimenti** (Movimenti → "+ Nuovo movimento"): acquisto, vendita, short, chiusura short,
    rata PAC, titolo nuovo, modifica ed eliminazione; **trasferimento** tra portafogli con `transferId` che lega uscita e entrata.
    Ogni scrittura è una transazione Firebase sul titolo (non si perde nulla se scrive anche la sincronizzazione IBKR). Provato sugli emulatori.
  - **Movimenti:** prezzo di negoziazione, filtri per periodo e tipo, short, margine e interessi.
  - **Note:** idee, prossime mosse, titoli da monitorare ed eventi con data, sincronizzate tra dispositivi.
- **Nuovo motore** (`app/src/domain/engine/`, 70 test). Applica le regole di [regole-fiscali.md](regole-fiscali.md):
  - costo medio in amministrato, LIFO in dichiarativo;
  - short inclusi nel cassetto;
  - cambi storici della Banca d'Italia, mai quello di oggi;
  - titoli di Stato al 48,08%, crypto al 33%, plus di ETF e fondi non compensabili.
- **Verificato sui dati reali.** Ha corretto 4 bug del vecchio motore:
  - cambio di oggi usato nel cassetto;
  - short esclusi dal cassetto;
  - minus dell'anno in dichiarativo non compensate;
  - titoli in CAD convertiti col cambio USD.
- **IBKR**
  - Portafoglio riconciliato con il rendiconto 2026 (9 correzioni applicate, ISIN aggiunti).
  - **Sincronizzazione automatica attiva** (Worker `ibkr-sync`, ogni giorno alle 06:00 UTC), senza doppioni; i casi dubbi finiscono "da controllare".
  - **Movimenti di cassa** (dal report Flex, senza doppioni): dividendi, ritenute, pagamenti sostitutivi, interessi attivi,
    prestito titoli (SYEP) e commissioni vanno in `cashflows` del portafoglio, con importo con segno e cambio; gli interessi di
    margine vanno in `marginInterest` (una riga per mese e valuta, somma dei singoli addebiti, stesso formato del sito vecchio).
    Tipi sconosciuti finiscono "da controllare". Provato solo con test: il report del 20/11 non conteneva movimenti di cassa.
  - **Avviso nella Panoramica della v2:** esito dell'ultima sincronizzazione (importate, da controllare, non gestite) ed eventuale errore.
- **Dati corretti su richiesta di Andrea:** tolta la minus MBB doppia su IBKR, MCHT.MI segnato come ETF.

## Da fare, in ordine di priorità
1. **Costo fiscale dei trasferimenti tra portafogli:** oggi il costo in EUR dei titoli trasferiti da Mediolanum a
   IBKR (AMZN, GOOGL, INTC, MSFT, PLUG, AMD…) usa il cambio del giorno del trasferimento. Deve restare quello
   degli acquisti originali. Collegare entrata e uscita tramite `transferId` nel motore (`portfolio.ts`) e
   calcolare tutti i portafogli insieme.
2. **Sincronizzazione IBKR: resta da fare** (il resto è fatto, vedi sopra):
   - **Opzioni:** la call BMEA 21JAN28 1.5 è segnalata ma non gestita (serve un tipo di movimento "opzione").
   - **Azioni "premio versamento"** IBKR: maturano dal 2027.
   - **Mostrare nella v2** dividendi, ritenute, interessi attivi e prestito titoli (oggi sono solo salvati in `cashflows`)
     e usarli nel fiscale (dividendi: vedi regole-fiscali.md).
   - Dopo il primo addebito mensile di interessi (inizio dicembre) controllare nell'avviso della Panoramica che i movimenti di cassa arrivino.
3. **Movimenti nella v2: resta da fare** il PAC automatico (oggi si inserisce la singola rata, segnata "PAC"),
   la modifica/eliminazione dei trasferimenti (si inseriscono ma non si correggono dalla v2) e la scelta dei lotti da vendere.
   Dopo che Andrea l'ha usata a mano per qualche giorno si può dismettere il sito vecchio per l'inserimento.
4. **Simulatore acquisto/vendita** nella v2: nuovo PMC, costi, tasse con le minus disponibili. Più il carrello.
5. **Margine:** quota a margine per acquisto con tasto MAX, interessi giornalieri per posizione con il tasso IBKR
   (dal report Flex), sub-totale in alto.
6. **Dashboard:** grafici storici di valore e performance confrontati con gli indici; pannello indici (Nasdaq 100,
   S&P 500, VIX, VXN) con lancetta del VIX che avverte vicino a 25.
7. **Watchlist** importate da IBKR (CSV) e avvisi di prezzo illimitati (cron del Worker + notifiche push).
8. **Fase 3, grafica definitiva** della v2 (oggi è provvisoria).
9. **Multiutente:** gestione degli inviti dentro la v2 (oggi solo nel sito vecchio), primo accesso guidato.
10. **Assistente AI (Gemini)** nella v2, poi dismissione del sito vecchio.

## Da chiedere o verificare con Andrea
- I prospetti di Mediolanum e Trade Republic (plus, minus, cassetto) per confrontarli con il motore.
- I punti fiscali incerti elencati in fondo a [regole-fiscali.md](regole-fiscali.md).
- Cancellare dalla cartella Download la chiave `calcolo-pmc-firebase-adminsdk-*.json` (è già su Cloudflare).

## Strumenti utili (`tools/`)
- `confronto-motori.mjs`: vecchio motore contro nuovo, sull'ultimo backup.
- `scarica-flex.mjs` + `confronto-ibkr.mjs`: confronto con il report Flex.
- `riconcilia-ibkr-csv.mjs <rendiconto.csv>`: confronto dei movimenti con il rendiconto attività IBKR.
