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
- **Dati Trade Republic sistemati (21/11/2026, backup `.backup/database-20261121-154936.json`):** MCHT.MI ora è ETF, date delle 12 rate allineate a quelle di esecuzione di Trade Republic,
  8 rate mancanti aggiunte (prezzo = chiusura Yahoo, campo `priceEstimated: true`), nuovo titolo FTSE Global All-Cap (VALL.AS, ISIN IE000VAHT5T0) con 5 rate da 50 € (quella del 16/11 coi dati veri della fattura).
  Strumento: `tools/pac-trade-republic-2026.mjs`. Trade Republic non ha API ufficiali: i PAC futuri li genera la v2 (scheda "Piani PAC" in Movimenti).
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

## Stato al 21/11/2026 (fine sessione) — da dove ripartire
**Pubblicato su `main` e online** (v2 su `/portafoglio/v2/`): margine, scheda Cassa (Movimenti), dividendi e "Imposte stimate" nel Fiscale, PAC automatico, opzioni.
**PR aperte:** strumento opzioni + stato (#20) e prospetto per la dichiarazione (branch `dichiarazione`). Su `main` il resto è tutto unito; ultima verifica: 170 test verdi.

- **Dividendi (Fiscale):** per anno lordo, ritenute, 26% e netto. IBKR = dati veri dei movimenti di cassa (da gennaio 2026); gli altri portafogli = stima Yahoo
  (quantità prima dello stacco × importo; ritenuta 15% sui titoli USA). Dichiarativo: 26% sul lordo **senza credito per la ritenuta estera** (scelta prudente di Andrea).
  Amministrato: 26% sul netto della ritenuta estera (confermato sugli accrediti Mediolanum di Meta e Microsoft: netto/lordo ≈ 0,63).
- **Imposte stimate** (riquadro nel Fiscale): plus/minus + dividendi + bollo (amministrato) o IVAFE (+34,20 € conto estero, dichiarativo). Bollo/IVAFE sul valore di oggi, non al 31/12; anni passati non calcolati.
- **Trade Republic:** dati sistemati (MCHT.MI ETF, date delle rate, rate mancanti, nuovo titolo FTSE Global All-Cap `VALL.AS`). Le 12 rate con prezzo di chiusura Yahoo hanno `priceEstimated`
  e il badge "da confermare": Andrea può inserire il prezzo vero dalla fattura con "Modifica". Piani PAC già creati su Firebase (`settings/pacPlans`): MCHT.MI 25 € e VALL.AS 50 €, il 2 e il 16 del mese.
  **Prima prova reale: la rata del 2 dicembre** (aprire l'app il 3/12 e controllare che compaiano con l'avviso).
- **Opzioni:** vedi punto 1 qui sotto. Call BMEA nei dati IBKR; Worker ripubblicato.

## Da fare, in ordine di priorità
1. **Dichiarazione dei redditi (fatto il prospetto, 21/11/2026, PR `dichiarazione`):** Fiscale → "Prospetto per la dichiarazione (RT, RM, RW)"
   (`#/fiscale/dichiarazione`, solo portafogli dichiarativi). Motore in `app/src/domain/engine/taxReturn.ts` (13 test), dati in `data/useTaxReturn.ts`.
   Righi e colonne presi dalle istruzioni ufficiali Redditi PF 2026 (Fascicolo 2); nel 730 gli stessi dati vanno nei quadri T, M, W.
   - **RT sezione II-A:** RT11 corrispettivi e costi, RT52, RT13/RT71 minus pregresse (le più vecchie prima), RT72-RT74, RT102 minus da riportare. Titoli di Stato al 48,08%,
     plus di ETF/fondi spostate nel quadro RM (lettera B), crypto solo segnalate (sezione V-A non compilata).
   - **RM31:** un rigo per tipo e Stato: H dividendi, B ETF/fondi esteri, C prestito titoli (SYEP), G interessi; 26% sul lordo, nessun credito per la ritenuta estera.
     Stato dall'ISIN (tabella codici in `countries.ts`); interessi e SYEP con lo Stato del broker (Irlanda, `BROKER_ISO`).
   - **RW:** rigo unico codice 20 (deposito titoli, aggregazione ammessa dalle istruzioni) + prospetto per titolo da conservare; periodi di possesso col LIFO, valore iniziale/finale
     a prezzo di mercato (chiusura Yahoo al 31/12), **cambio medio mensile Banca d'Italia** (`lib/fxMonthly.ts`), giorni pesati, IVAFE 2‰ pro rata. Conto corrente: IVAFE 34,20 € solo
     se la giacenza media supera 5.000 € (la giacenza vera va letta sul rendiconto IBKR; oggi il saldo è a debito).
   - **Cambi:** di base Banca d'Italia del giorno; interruttore "Cambi IBKR" e confronto delle due versioni movimento per movimento.
   - Anno in corso = bozza (prezzi e cambi di oggi); dal 1/1 si aggiorna da solo coi valori al 31/12. Pulsanti "Copia tutto" e "Stampa / PDF".
   - Prova sugli emulatori con la copia dei dati del 21/11 (2026, cambi BdI): plus netta 4.675 €, imposta RT 1.216 €, RM 30 €, IVAFE ~64 €.
   - **Importa rendiconto IBKR (fatto, PR `importa-rendiconto`):** nel prospetto, tasto "Importa rendiconto (CSV)" (rendiconto di attività in italiano).
     Lettore e confronto in `app/src/domain/ibkr/statement.ts` (6 test): operazioni per titolo e giorno, dividendi/ritenute/interessi attivi/SYEP per valuta,
     posizioni a fine periodo (opzioni: simbolo IBKR → ticker OCC). Salva su Firebase in `users/{uid}/taxStatements/{pid}/{anno}` solo i prezzi di fine periodo
     e l'esito del confronto (fuori da `portfolio_state`, così la sincronizzazione non lo cancella). Se il rendiconto arriva al 31/12, i suoi prezzi di chiusura
     valgono per il quadro RW al posto di Yahoo. Prova col rendiconto 1/1–20/11/2026: 120 operazioni e tutti i movimenti di cassa coincidono;
     unica differenza **3,6168 azioni IBKR** (premio sui versamenti) nel conto ma non nell'app: da decidere come registrarle (trattamento fiscale da verificare).
   - **Da fare a inizio 2027:** confrontare i totali con il rendiconto annuale IBKR (Andrea lo invierà), verificare righi/colonne sulle istruzioni 2027 appena escono,
     decidere col commercialista i punti incerti (credito ritenute estere, cambio BdI o IBKR, giacenza media del conto). Mediolanum e Trade Republic: amministrati, servono solo le loro certificazioni.
2. **Sincronizzazione IBKR — resta:** azioni "premio versamento" (maturano dal 2027); assegnazione/esercizio di opzioni (vanno "da controllare", si registrano a mano);
   dopo il primo addebito mensile di interessi (inizio dicembre) controllare l'avviso della Panoramica per i movimenti di cassa. Totale in euro dei movimenti di cassa non ancora mostrato.
   **Opzioni (fatto):** titolo di tipo `option`, ticker Yahoo OCC (es. `BMEA280121C00001500`), quantità = contratti × 100, prezzo = premio per azione: il motore non cambia (26%).
   Scadenza senza valore = vendita a 0. Applicato: call BMEA 21JAN28 1.5 (100 quote a 1 $, 26/08/2026) con `tools/opzioni-ibkr-storico.mjs`, backup `.backup/database-20261121-162408.json`; Worker `ibkr-sync` ripubblicato.
3. **Movimenti nella v2:** modifica/eliminazione dei trasferimenti (si inseriscono ma non si correggono), scelta dei lotti da vendere. Dopo qualche giorno di uso si può dismettere il sito vecchio per l'inserimento.
4. **Simulatore:** "Registra come movimenti", bollo/IVAFE nella stima, simulazione di dividendi.
5. **Dashboard:** grafici storici di valore e performance confrontati con gli indici; pannello indici (Nasdaq 100, S&P 500, VIX, VXN) con lancetta del VIX vicino a 25.
6. **Watchlist** da IBKR (CSV) e avvisi di prezzo illimitati (cron del Worker + notifiche push). Eventuale notifica push per l'avviso di leva.
7. **Fase 3, grafica definitiva** della v2 (oggi provvisoria).
8. **Multiutente:** inviti dentro la v2 (oggi solo nel sito vecchio), primo accesso guidato.
9. **Assistente AI (Gemini)** nella v2, poi dismissione del sito vecchio.

## Da chiedere o verificare con Andrea
- Aggiornare la PWA sul telefono (chiuderla e riaprirla due volte) e controllare: scheda "Dividendi" nel Fiscale per ogni portafoglio (Mediolanum: Meta ≈ 0,58 €, Microsoft ≈ 3,45 € netti), scheda "Piani PAC".
- Dopo qualche giorno di uso: i movimenti inseriti a mano nella v2 tornano con i numeri attesi? (verificato solo sugli emulatori)
- I prospetti di Mediolanum e Trade Republic (plus, minus, cassetto) per confrontarli con il motore.
- I punti fiscali incerti elencati in fondo a [regole-fiscali.md](regole-fiscali.md).
- Cancellare dalla cartella Download la chiave `calcolo-pmc-firebase-adminsdk-*.json` (è già su Cloudflare).
- Emulatori Firebase lasciati accesi da questa sessione (processi Java in background): si chiudono con il riavvio del PC.

## Strumenti utili (`tools/`)
- `confronto-trasferimenti.mjs`: costo dei titoli trasferiti, prima e dopo il collegamento dei trasferimenti.
- `confronto-motori.mjs`: vecchio motore contro nuovo, sull'ultimo backup.
- `scarica-flex.mjs` + `confronto-ibkr.mjs`: confronto con il report Flex.
- `riconcilia-ibkr-csv.mjs <rendiconto.csv>`: confronto dei movimenti con il rendiconto attività IBKR.
- `pac-trade-republic-2026.mjs`: sistemazione una tantum dei PAC di Trade Republic (21/11/2026).
- `opzioni-ibkr-storico.mjs`: aggiunge ai dati IBKR le opzioni del report Flex dell'anno.
