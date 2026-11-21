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
  - **Costo fiscale dei trasferimenti:** `computeAllPortfolios` calcola tutti i portafogli insieme; un titolo trasferito
    (stesso `transferId`) porta con sé i lotti, il costo e le date degli acquisti originali, non il cambio del giorno del trasferimento.
    Sui dati reali il costo dei titoli trasferiti verso IBKR sale un po' e le plus realizzate cambiano di poco
    (confronto in `.backup/confronto-trasferimenti.md`, non pubblicato, creato da `tools/confronto-trasferimenti.mjs`). Entrate senza uscita collegata (o con quantità diversa) ricadono sul vecchio calcolo con avviso.
    Limite: giri A→B→A ricadono sul calcolo semplice.
  - **Inserimento e modifica dei movimenti** (Movimenti → "+ Nuovo movimento"): acquisto, vendita, short, chiusura short,
    rata PAC, titolo nuovo, modifica ed eliminazione; **trasferimento** tra portafogli con `transferId` che lega uscita e entrata.
    Ogni scrittura è una transazione Firebase sul titolo (non si perde nulla se scrive anche la sincronizzazione IBKR). Provato sugli emulatori.
  - **Simulatore** (menu Simulatore): carrello di acquisti, vendite e short; mostra nuovo PMC, plus/minus, imposta stimata
    (costo medio o LIFO secondo il regime, minus del cassetto usate, in dichiarativo anche il risparmio sulle plus già
    realizzate nell'anno), cassa netta, tasto MAX. Rifà il calcolo col motore vero su una copia del portafoglio: non salva nulla.
  - **Movimenti:** prezzo di negoziazione, filtri per periodo e tipo, short, margine e interessi.
  - **Note:** idee, prossime mosse, titoli da monitorare ed eventi con data, sincronizzate tra dispositivi.
- **Nuovo motore** (`app/src/domain/engine/`; 123 test in tutto il progetto). Applica le regole di [regole-fiscali.md](regole-fiscali.md):
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

## Margine: decisioni di Andrea (21/11/2026) e avanzamento
- **Il margine è il saldo di cassa negativo per valuta**: ogni vendita lo riduce, a prescindere da cosa si vende. Niente "quota a margine che segue il titolo".
- **Pezzo 1 (fatto, in PR):** `flex.ts` legge `CashReportCurrency`, `InterestAccruals` e `TierInterestDetail`; la sincronizzazione salva nel portafoglio
  `marginStatus` (foto: saldo per valuta, totale in €, maturato, ultimo tasso) e `marginDaily` (una riga per giorno e valuta a debito, senza doppioni).
- **Pezzo 2 (fatto, in PR):** riquadro **Margine** in Panoramica e Posizioni (`MarginCard`, motore in `domain/engine/margin.ts`): margine usato (saldo reale IBKR,
  per valuta e totale in €), **leva** = esposizione lorda (long + |short|) / patrimonio netto, interessi pagati nell'anno + maturati, costo stimato al giorno e al mese
  (tasso attuale, 360 giorni; 365 per GBP/CAD/AUD…). Compare solo per i portafogli con `marginStatus`.
- **Avviso leva:** campo "Leva massima" nel riquadro, **salvato su Firebase** (`users/{uid}/settings/maxLeverage`, uguale su tutti i dispositivi e in tempo reale);
  avviso giallo sopra il 90% della soglia, rosso sopra la soglia. Da fare, se serve: notifica push.
- **Saldo a margine su ogni acquisto (fatto):** nei Movimenti, sotto ogni acquisto, "conto a margine: X USD" oppure "conto senza margine". Dati da `marginDaily`;
  `marginHistoryFrom` è il primo giorno coperto dai report (dove non ci sono righe di debito il conto era senza margine; prima non si mostra nulla).
- **Storico dell'anno da IBKR:** il Flex Web Service accetta le date `fd`/`td` (max 365 giorni, l'ultimo giorno disponibile è l'ultimo lavorativo chiuso).
  `node tools/scarica-flex.mjs 2026-01-01 2026-11-19` scarica il report in `.backup/`; `node --experimental-strip-types tools/storico-ibkr.mjs <file.xml> [--salva]`
  lo applica a secco al portafoglio IBKR del backup e mostra cosa cambierebbe.
  **Applicato ai dati veri il 21/11/2026** (backup `.backup/database-20261121-022825.json`): tutti i 112 ordini dell'anno ora hanno l'id IBKR
  (72 collegati ai movimenti manuali, con prezzo, commissioni e cambio esatti; 40 già collegati dalla sincronizzazione), 27 movimenti di cassa in `cashflows`,
  9 mesi in `marginInterest`, 184 giorni di debito in `marginDaily` (17/06–18/11), `marginHistoryFrom` = 2026-01-01. Movimenti: 120 prima e dopo.
- **Bug corretto (21/11/2026):** la sincronizzazione sceglieva il titolo per ISIN senza guardare la valuta: AHLA (Alibaba a Francoforte, EUR) e BABA (NYSE, USD)
  hanno lo stesso ISIN e una vendita AHLA veniva aggiunta a BABA. Ora si cerca ISIN + valuta, poi ticker + valuta, poi solo ISIN.
- **Nota tecnica:** Firebase scarta i `null`: i campi opzionali salvati (es. `ratePct`) possono mancare, vanno letti con `== null`.
- **Non si fa più:** quota a margine stimata per titolo e tasto MAX (decisione di Andrea). Il campo `marginAmount` dei movimenti resta com'è.

## Prossimo passo (vecchio, superato dalle decisioni qui sopra): gestione del margine (punto 4 qui sotto)
Andrea vuole farla in una chat nuova, con calma, perché è importante. Punto di partenza:
- **Cosa c'è già.** Sui movimenti di acquisto il campo `marginAmount` (quota finanziata a margine, stesso formato del sito vecchio:
  si inserisce nella modifica del movimento, solo per gli acquisti). Il portafoglio ha `marginInterest`: righe mensili
  `{ id, period: 'YYYY-MM', currency, amount, source, externalId: 'MI:periodo:valuta', parts }`, riempite dalla sincronizzazione IBKR
  (`app/src/domain/ibkr/sync.ts`, funzione `applyCash`) o a mano nel sito vecchio. La v2 le mostra in Movimenti → "Interessi margine"
  (`app/src/domain/engine/movements.ts`, `marginInterest()`).
- **Cosa manca (richieste di Andrea):**
  1. Nella v2: inserire la quota a margine di un acquisto (maschera movimenti e simulatore), con tasto **MAX** = massimo finanziabile.
  2. **Interessi giornalieri per posizione** col tasso IBKR: il report Flex ha la sezione `TierInterestDetail` (data, valuta, capitale
     `totalPrincipal`, tasso `rate`, interesse `totalInterest`) e `InterestAccruals` (interessi maturati e non ancora addebitati).
     Il sito vecchio le legge già in `js/modules/portfolio/ibkr-flex.js` (`interestDaily`, `accruals`); `app/src/domain/ibkr/flex.ts`
     oggi non le legge. Va deciso come ripartire l'interesse tra le posizioni (in proporzione alla quota a margine di ciascuna).
  3. **Sub-totale in alto** (interessi e margine usato) nella Panoramica o in Posizioni.
- **Da chiarire con Andrea prima di scrivere codice:** come si ripartisce il margine tra posizioni quando cambia nel tempo (vendite
  parziali), se la quota a margine deve ridursi con le vendite, e quale tasso usare per le proiezioni. Il margine IBKR vero è un
  saldo di cassa negativo per valuta, non una quota per titolo: conviene capire se mostrare il saldo reale (dal Flex) accanto alla stima.
- Il vecchio sito calcola il totale interessi in `js/modules/portfolio/render.js` (`renderKPI`, `totaleInteressiEur`).

## Da fare, in ordine di priorità
1. **Sincronizzazione IBKR: resta da fare** (il resto è fatto, vedi sopra):
   - **Opzioni:** la call BMEA 21JAN28 1.5 è segnalata ma non gestita (serve un tipo di movimento "opzione").
   - **Azioni "premio versamento"** IBKR: maturano dal 2027.
   - **Mostrati nella v2** (Movimenti → scheda "Cassa": elenco e totali per tipo e valuta del periodo). Resta da fare
     usarli nel fiscale (dividendi: vedi regole-fiscali.md) e il totale in euro.
   - Dopo il primo addebito mensile di interessi (inizio dicembre) controllare nell'avviso della Panoramica che i movimenti di cassa arrivino.
2. **Movimenti nella v2: resta da fare** il PAC automatico (oggi si inserisce la singola rata, segnata "PAC"),
   la modifica/eliminazione dei trasferimenti (si inseriscono ma non si correggono dalla v2) e la scelta dei lotti da vendere.
   Dopo che Andrea l'ha usata a mano per qualche giorno si può dismettere il sito vecchio per l'inserimento.
3. **Simulatore: resta da fare** "Registra come movimenti" (trasforma il carrello in operazioni vere), l'imposta di bollo/IVAFE
   nella stima e la simulazione di dividendi.
4. **Margine** (vedi "Prossimo passo" sopra): quota a margine per acquisto con tasto MAX, interessi giornalieri per posizione
   con il tasso IBKR (dal report Flex), sub-totale in alto.
5. **Dashboard:** grafici storici di valore e performance confrontati con gli indici; pannello indici (Nasdaq 100,
   S&P 500, VIX, VXN) con lancetta del VIX che avverte vicino a 25.
6. **Watchlist** importate da IBKR (CSV) e avvisi di prezzo illimitati (cron del Worker + notifiche push).
7. **Fase 3, grafica definitiva** della v2 (oggi è provvisoria).
8. **Multiutente:** gestione degli inviti dentro la v2 (oggi solo nel sito vecchio), primo accesso guidato.
9. **Assistente AI (Gemini)** nella v2, poi dismissione del sito vecchio.

## Da chiedere o verificare con Andrea
- Dopo qualche giorno di uso: i movimenti inseriti a mano nella v2 tornano con i numeri attesi? (verificato solo sugli emulatori)
- I prospetti di Mediolanum e Trade Republic (plus, minus, cassetto) per confrontarli con il motore.
- I punti fiscali incerti elencati in fondo a [regole-fiscali.md](regole-fiscali.md).
- Cancellare dalla cartella Download la chiave `calcolo-pmc-firebase-adminsdk-*.json` (è già su Cloudflare).

## Strumenti utili (`tools/`)
- `confronto-trasferimenti.mjs`: costo dei titoli trasferiti, prima e dopo il collegamento dei trasferimenti.
- `confronto-motori.mjs`: vecchio motore contro nuovo, sull'ultimo backup.
- `scarica-flex.mjs` + `confronto-ibkr.mjs`: confronto con il report Flex.
- `riconcilia-ibkr-csv.mjs <rendiconto.csv>`: confronto dei movimenti con il rendiconto attività IBKR.
