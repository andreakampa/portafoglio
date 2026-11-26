# Stato del progetto — aggiornato al 24/11/2026

## Obiettivo
Un'app (PWA, telefono e PC) per seguire più portafogli (IBKR dichiarativo, Mediolanum e Trade Republic
amministrati), con prezzo medio di carico, simulazioni di acquisto/vendita, cassetto fiscale corretto secondo
le regole italiane, note, margine e grafici. Da passare in futuro ad amici e parenti (multiutente con inviti).

## Fatto
- **Sicurezza**
  - Proxy Cloudflare limitato a Yahoo, cambi e Banca d'Italia e alle sole richieste dal sito.
  - **Worker più severi (25/11/2026):** `finance-proxy` e `ibkr-relay` non accettano più localhost; limite al minuto per IP
    (proxy 600, `/chat` 10, relay 20; binding `ratelimits` in `wrangler.jsonc`), oltre il limite rispondono 429. In locale la v2
    passa da `/__proxy` di Vite, che si presenta come il sito pubblicato. Test: `npm run test:workers` (anche in CI).
    Il sito vecchio aperto su localhost non riceve più i prezzi (si usa quello pubblicato).
  - Regole Firebase con inviti monouso, membri e admin (38 test).
  - Codice dei Worker nel repository.
  - **Content Security Policy nella v2** (`app/src/security/csp.ts`, messa nella pagina solo alla build): ammessi solo il sito, Firebase,
    il proxy Cloudflare e i 3 siti dei loghi. Una nuova API o fonte di immagini va aggiunta lì, altrimenti il browser la blocca.
  - **Sito vecchio:** le 3 librerie da CDN (jsPDF, autotable, xlsx) hanno l'impronta `integrity`; cambiando versione va ricalcolata.
    Restano senza impronta i moduli Firebase da gstatic (import ES).
  - Clic sulle notifiche: si aprono solo pagine dell'app.
- **Account degli amici (25/11/2026, PR account-amici):** decisioni di Andrea: sospensione → 30 giorni di sola lettura con avviso a ogni accesso
    e email già scritta → poi "Cancella i dati" (le regole lo permettono all'admin solo dopo `members/{uid}/deleteAfter`, e solo come cancellazione: l'admin non legge né scrive i dati degli altri).
    Chiusura del sito: `/notice` con `closesAt` a 60 giorni, avviso in app a tutti ed email in copia nascosta. Per tutti: "Scarica i miei dati" (JSON completo di `users/{uid}`)
    ed "Elimina il mio account" (non per l'admin). Motore `app/src/domain/accountLifecycle.ts`, schermate `components/AccountLifecycle.tsx`, 27 nuovi test delle regole.
    Dopo l'unione serve `firebase deploy --only database`. L'account di accesso di chi viene cancellato dall'admin resta in Firebase → Authentication (solo email): si toglie da lì.
    **Password dimenticata (25/11/2026):** link nella schermata di accesso, email di Firebase in italiano (`sendPasswordResetEmail`); stesso messaggio se l'email non esiste.
    Con la cifratura dei dati degli amici il reset dovrà passare dalla chiave di recupero.
    **Avvisi di prezzo per più utenti:** `runAlerts` (ibkr-sync) scarica un prezzo per titolo per tutti e resta sotto le 50 richieste per giro del piano gratuito Cloudflare;
    se i titoli sono troppi li controlla a turno (`planQuotes`, cursore in `alerts_state/cursor`). Va ripubblicato il Worker.
    **Cifratura dei dati degli amici** (decisa: tutto cifrato tranne watchlist, soglie e notifiche; i dati di Andrea restano in chiaro per IBKR e sito vecchio).
    Passo 1 fatto: `app/src/lib/crypto.ts` (chiave dei dati AES-GCM, buste con password e chiave di recupero via PBKDF2 600.000 giri, AAD = percorso), 13 test.
    Passo 2 fatto: `auth/CryptoGate.tsx` prima dell'app (solo non admin): chiave creata alla registrazione con chiave di recupero da salvare, busta in `users/{uid}/crypto`,
    chiave ricordata sul dispositivo in IndexedDB (non estraibile, `lib/keyStore.ts`) fino a "Esci"; dopo un reset via email si sblocca con la chiave di recupero; il cambio password richiude la busta.
    `useDataKey()` dà la chiave (null per l'admin). Provato sugli emulatori: registrazione, ricarica, altro dispositivo, reset+recupero, cambio password.
    Passo 3 fatto: `lib/vault.ts` sostituisce firebase/database in tutti gli hook dei dati (stessi nomi); per gli invitati cifra e decifra, per l'admin va diretto.
    Unità cifrate (`lib/vaultTree.ts`): un portafoglio intero, ogni altra voce al 2° livello; in chiaro `crypto`, `settings/watchlist`, `settings/push`.
    Scritture dentro un'unità = rileggi-cambia-richiudi con controllo che nessuno abbia scritto nel frattempo. L'export ("Scarica i miei dati") è già decifrato.
    Il sito vecchio non legge i dati cifrati: il collegamento è nascosto agli invitati. Provato sugli emulatori (nessun dato in chiaro su Firebase, app e export leggono tutto).
    Passo 4 fatto: regole (`users/$uid`): per chi non è admin ogni unità deve essere `{__s:{iv,ct}}` e nient'altro; in chiaro solo `crypto`, `settings/watchlist`, `settings/push` (81 test).
    Passo 5 (export decifrato) incluso nel 3. Passo 6 fatto: informativa `components/PrivacyText.tsx` alla registrazione e in Impostazioni → Privacy.
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
  - **Grafico Andamento (Panoramica):** viste Valore e Performance come su IBKR, S&P 500 e Nasdaq 100 accendibili; scelta salvata in `settings/historyChart`.
  - **Pannello Mercati (Panoramica, 25/11/2026):** due pagine da sfogliare. Indici: lancetta del VIX a fasce (calmo <20, nervoso 20–25,
    paura 25–30 giallo, paura estrema da 30 rosso), Nasdaq 100, S&P 500, VIX, VXN, EUR/USD, BTC ed ETH in dollari; variazione del giorno
    verde/rossa, prezzo che lampeggia quando cambia, aggiornamento ogni minuto con l'app in primo piano. Fuori orario sugli indici ☀️ (pre)
    o 🌇 (sera) con la variazione del future (Yahoo non dà il pre-mercato degli indici); festività USA non considerate.
    Futures: ES, NQ, YM, RTY con sentiment di apertura (media oltre ±0,30%). Tutto da Yahoo via proxy, logica in `domain/market.ts`.
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
- **Stress test della leva (25/11/2026, in PR):** nel riquadro Margine, cursore e campo % "Se il portafoglio cambia di…" (da −70% a +50%, scenari 2022/Covid/2008):
  valore delle posizioni, patrimonio netto, leva, liquidità in eccesso e a quale calo scatta la margin call (`domain/engine/marginStress.ts`).
  Il report Flex non contiene il margine di mantenimento: si usa il 25% (standard IBKR azioni), correggibile nel campo "Mantenimento IBKR"
  (salvato in `users/{uid}/settings/maintMarginPct`).
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

## Parità con il sito vecchio (23-24/11/2026) — da dove ripartire
Checklist: [Parita sito vecchio.md](Parita%20sito%20vecchio.md). **Il sito vecchio non si dismette finché non è tutta spuntata.**
Fatti e pubblicati (PR #34-#42): 0 colori con icona (tema giorno verde acqua scuro), 1 telefono/layout, 2 barra prezzi (EUR/USD, €/$, peso, cassetto,
Aggiorna), 3 dodici numeri chiave, 4 tabella Posizioni (colonne su Firebase `settings/positionColumns`, ordinamento, gruppi, logo, 52 settimane,
grafico del giorno, pallino dividendi, PDF/Excel), 5 azioni sulla riga in finestra, 6 Storico del titolo, 7 Dividendi del titolo
(netto reale in `settings/dividendActuals`), 8 posizioni chiuse. Poi (PR #44-#50, 24/11/2026): 10 anteprima del movimento, blocco vendite oltre la quantità, ricerca titolo Yahoo; 11 minus a mano e scadenze nel Fiscale; 12 Movimenti con periodo dal/al, imposta, export, interessi a mano; 13 PAC completo (modifica, riepilogo, rate saltate `skipDates`, titoli non in euro); 14 carrello salvato in `settings/simCart`; 15 cambio password, svuota cache, avvisi a comparsa, assistente formattato. **Resta:** 9 cassetto fiscale da verificare con Andrea, le decisioni in fondo alla checklist (privacy assistente, comandi IBKR dal browser) e la correzione a mano del compensato (solo se serve).
Prove nel browser: Chrome headless + emulatori con la copia del backup (script in scratchpad di sessione, non salvato nel repo).

## Stato al 21/11/2026 (fine sessione)
**Pubblicato su `main` e online** (v2 su `/portafoglio/v2/`): margine, scheda Cassa (Movimenti), dividendi e "Imposte stimate" nel Fiscale, PAC automatico, opzioni.
**PR aperte:** strumento opzioni + stato (#20) e prospetto per la dichiarazione (branch `dichiarazione`). Su `main` il resto è tutto unito; ultima verifica: 170 test verdi.

- **Dividendi (Fiscale):** per anno lordo, ritenute, 26% e netto. IBKR = dati veri dei movimenti di cassa (da gennaio 2026); gli altri portafogli = stima Yahoo
  (quantità prima dello stacco × importo; ritenuta 15% sui titoli USA). Dichiarativo: 26% sul lordo **senza credito per la ritenuta estera** (scelta prudente di Andrea).
  Amministrato: 26% sul netto della ritenuta estera (confermato sugli accrediti Mediolanum di Meta e Microsoft: netto/lordo ≈ 0,63).
- **Imposte stimate** (riquadro nel Fiscale): plus/minus + dividendi + bollo (amministrato) o IVAFE (+34,20 € conto estero, dichiarativo). Bollo/IVAFE sul valore di oggi, non al 31/12; anni passati non calcolati.
- **Trade Republic:** dati sistemati (MCHT.MI ETF, date delle rate, rate mancanti, nuovo titolo FTSE Global All-Cap `VALL.AS`). Le 12 rate con prezzo di chiusura Yahoo hanno `priceEstimated`
  e il badge "da confermare": Andrea può inserire il prezzo vero dalla fattura con "Modifica". Piani PAC già creati su Firebase (`settings/pacPlans`): MCHT.MI 25 € e VALL.AS 50 €, il 2 e il 16 del mese.
  **Conferma rapida (25/11/2026, PR conferma-rate):** nello Storico del titolo riquadro "N movimenti da confermare" con **Conferma tutte** (elenco con caselle) e spunta per confermare una riga; nella modifica di una rata PAC campo "Importo della rata" e quantità ricalcolata da sola (importo × cambio ÷ prezzo, `pacQty`/`pacRate` in `app/src/domain/txEdit.ts`) finché non la si scrive a mano. **Import estratto Trade Republic (fatto):** tasto "Importa da Trade Republic" nello Storico e in "Piani PAC"; legge il CSV "transactions_<dal>_<al>.csv" esportato dall'app TR (solo righe TRADING, il resto del file si ignora e non si salva), collega per ISIN del titolo + giorno (±3) + importo (±25%), anteprima con caselle, poi scrive. Il file vince su quantità, prezzo e commissioni (decisione di Andrea); le righe nuove (es. Saveback) si aggiungono con `trId` = transaction_id, così un secondo import non crea doppioni. Motore `app/src/domain/tradeRepublic.ts` (9 test). Provato sugli emulatori col file vero di Andrea (non salvato nel repo).
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
     unica differenza le **3,6168 azioni IBKR** del premio sui versamenti: decise e gestite il 22/11/2026 (vedi Azioni premio IBKR qui sotto).
   - **Azioni premio IBKR (fatto, 22/11/2026, PR `azioni-premio`):** l'import del rendiconto salva le assegnazioni ("Attività piano incentivazione")
     in `users/{uid}/settings/bonusGrants/{pid}/{id}`; nel confronto le azioni non maturate non sono più una differenza. `BonusRunner` (come i PAC) registra
     da solo, il giorno dopo ogni maturazione, l'acquisto al prezzo di chiusura (`bonusKey`, `priceEstimated`): è il costo fiscale e il reddito nel quadro RM (G, 26%).
     Prima della maturazione le azioni entrano solo nel quadro RW. Regola in [regole-fiscali.md](regole-fiscali.md). Oggi: 9 assegnazioni, 3,6168 IBKR, prima maturazione 30/04/2027.
     **Da controllare a maggio 2027:** se la sincronizzazione IBKR vede la maturazione come un movimento (rischio doppione o "da controllare").
   - **Da fare a inizio 2027:** confrontare i totali con il rendiconto annuale IBKR (Andrea lo invierà), verificare righi/colonne sulle istruzioni 2027 appena escono,
     decidere col commercialista i punti incerti (credito ritenute estere, cambio BdI o IBKR, giacenza media del conto). Mediolanum e Trade Republic: amministrati, servono solo le loro certificazioni.
2. **Sincronizzazione IBKR — resta:** azioni "premio versamento" (maturano dal 2027); assegnazione/esercizio di opzioni **fatto (22/11/2026, PR `opzioni-esercizio`)**: la sincronizzazione collega opzione e azioni (premio nel costo o ricavo, vedi regole-fiscali.md), modulo manuale Movimenti → Esercizio / assegnazione; restano "da controllare" solo le opzioni regolate in contanti (senza azioni nel report);
   dopo il primo addebito mensile di interessi (inizio dicembre) controllare l'avviso della Panoramica per i movimenti di cassa. Totale in euro dei movimenti di cassa: fatto (scheda Cassa, cambio del giorno salvato da IBKR o di oggi, `cashTotalsEur`).
   **Opzioni (fatto):** titolo di tipo `option`, ticker Yahoo OCC (es. `BMEA280121C00001500`), quantità = contratti × 100, prezzo = premio per azione: il motore non cambia (26%).
   Scadenza senza valore = vendita a 0. Applicato: call BMEA 21JAN28 1.5 (100 quote a 1 $, 26/08/2026) con `tools/opzioni-ibkr-storico.mjs`, backup `.backup/database-20261121-162408.json`; Worker `ibkr-sync` ripubblicato.
3. **Movimenti nella v2 (fatto, 22/11/2026, PR `movimenti-trasferimenti`):** i trasferimenti si correggono (data e quantità) e si eliminano dalla lista Movimenti;
   uscita ed entrata cambiano insieme in una sola scrittura (`findTransfer`/`transferWrites` in `domain/txEdit.ts`), con controllo delle quantità disponibili da una parte e già vendute dall'altra.
   **Scelta dei lotti: non si fa** (LIFO obbligatorio in dichiarativo, costo medio in amministrato: vedi regole-fiscali.md).
   Date dei trasferimenti da Mediolanum allineate al rendiconto IBKR il 22/11/2026: AHLA e RACE al **26/05/2026** (uscita ed entrata), gli altri 6 erano già giusti al 28/05 (backup `.backup/database-20261122-191834.json`).
   ~~Dopo qualche giorno di uso si può dismettere il sito vecchio~~: annullato, vedi checklist di parità.
4. **Simulatore:** "Registra come movimenti" **fatto** (22/11/2026): data scelta, prezzo simulato segnato "da confermare", `source: 'simulatore'`;
   su IBKR la sincronizzazione lo collega all'ordine vero (stesso giorno, tipo e quantità, prezzo entro l'1%). **Bollo/IVAFE e dividendi nella stima: fatto** (`simulateExtras`): 2‰ annuo sulla variazione del valore dei titoli long (e quota dei giorni che restano dell'anno), dividendi degli ultimi 12 mesi × nuova quantità, netti come nel resto dell'app. Simulatore completo.
   **Cambi dei giorni recenti:** per i movimenti degli ultimi 7 giorni senza cambio Banca d'Italia (pubblicato nel pomeriggio) si usa quello di oggi finché arriva l'ufficiale (`withRecentFallback`).
5. **Dashboard (fatto, 22/11/2026, PR `dashboard`):** in Panoramica riquadro **Mercati** (Nasdaq 100, S&P 500, VIX, VXN con variazione del giorno; lancetta del VIX 0-50 con tacca a 25: calmo/nervoso/paura, `domain/market.ts`) e **Andamento** del portafoglio scelto: valore e capitale investito, rendimento time-weighted confrontato con S&P 500 e Nasdaq 100 in euro (1 mese, 3 mesi, da inizio anno, 1 anno, tutto). Motore `domain/engine/history.ts` (test), dati Yahoo via Worker (`data/useHistory.ts`, cache in memoria), grafici SVG senza librerie (`components/LineChart.tsx`, mirino e legenda, colori della palette validata per daltonismo). Limiti: dividendi e interessi non inclusi nel rendimento; prezzi e cambi di mercato, non fiscali.
   **Operazioni recenti (25/11/2026, PR operazioni recenti):** riquadro in Panoramica (colonna destra) che apre una finestra con acquisti e aperture di short degli ultimi 1, 3 o 7 giorni di calendario (scelta ricordata sul dispositivo): costo con commissioni al cambio del giorno, valore ai prezzi e cambio di adesso, variazione in € e %, P&L non realizzato totale. Se poi si vende, la riga resta con "venduta il…" e il risultato, fuori dal non realizzato (si chiude prima l'acquisto più recente). Motore `domain/recentTrades.ts` (6 test).
6. **Watchlist e avvisi (fatto, 22/11/2026, PR `watchlist`):** pagina Watchlist (barra laterale su PC, riquadro in Panoramica sul telefono): titoli, prezzo e variazione, soglie sopra/sotto e nota, importazione da CSV IBKR (TWS/Portale o elenco; simboli convertiti per Yahoo: RACEm→RACE.MI, IBIS→.DE…). Dati in `users/{uid}/settings/watchlist`. **Notifiche push**: il Worker `ibkr-sync` ha un secondo cron `*/15 * * * *` (`runAlerts`): legge watchlist e abbonamenti (`settings/push`), prezzi Yahoo, `checkAlerts` (una notifica per soglia, si riarma quando il prezzo torna indietro), Web Push cifrato senza librerie (`lib/webpush.ts`, verificato con l'esempio ufficiale RFC 8291), abbonamenti scaduti cancellati. Chiave VAPID: pubblica in `lib/push.ts` e in `wrangler.jsonc`, privata come secret `VAPID_PRIVATE` (copia in `.backup/vapid-private.txt`). Provato in locale con emulatori e finto servizio push. **Andrea deve attivare le notifiche dal telefono** (Watchlist → Attiva le notifiche; su iPhone solo con l'app aggiunta alla schermata Home). Da fare se serve: notifica push per l'avviso di leva.
   **Watchlist IBKR (22/11/2026):** importate le 13 watchlist del conto (105 titoli) con il connettore IBKR; ogni titolo ha `lists` (filtro per lista nella pagina) e `source: ibkr`. **Allineamento settimanale**: attività programmata di Claude `allinea-watchlist-ibkr` (domenica 21:10, gira dall'app Claude del PC): legge le watchlist con il connettore → `.backup/ibkr-watchlists.json` → `tools/watchlist-ibkr.mjs` (regole `mergeIbkrWatchlists`: solo aggiunte, soglie/note e titoli aggiunti a mano mai toccati, titoli tolti da IBKR solo segnati `goneFromIbkr`) → `firebase database:update`. Si annulla dalla sezione «Programmate» dell'app Claude. Simbolo «OS» (Spazio) non trovato su Yahoo: da controllare.
7. **Grafica definitiva (fatto, 22/11/2026, PR `tema-e`):** temi scelti da Andrea sulla pagina di prova (artifact «Temi Portafoglio»): **E giorno** (carta e inchiostro, blu profondo) ed **E sera** (ardesia, verde acqua; arancio solo per gli avvisi). Stessi caratteri nei due temi (titoli Source Serif 4, testo e numeri Inter, ospitati nell'app con @fontsource, funzionano offline). Impostazioni → Tema: automatico/chiaro/scuro (`lib/theme.ts`, `data-theme` su <html>, per dispositivo). Guadagni e perdite con ▲ ▼ oltre al colore (`tone()` → classi up/down). Menu: PC barra laterale scura a tre gruppi; telefono barra con 5 voci (Home, Posizioni, + nuovo movimento, Fiscale, Altro) e pagina **Altro**. Panoramica: 4 numeri chiave (valore e variazione di oggi, non realizzato, realizzato dell'anno, imposta), poi su PC due colonne (andamento e posizioni principali | mercati, watchlist, margine).
8. **Multiutente (fatto, 22/11/2026, PR `inviti-v2`):** Impostazioni → **Inviti** (solo admin): crea codice con nota, **Condividi** (WhatsApp/mail con link `…/v2/?invito=CODICE`, oppure copia), elimina i liberi, elenco con chi li ha usati. Il link apre la registrazione con il codice già scritto. **Primo accesso guidato**: senza portafogli la Panoramica mostra «Benvenuto!» con i tre passi e la creazione del primo portafoglio (spiegazione amministrato/dichiarativo). Impostazioni → **Portafogli**: rinomina e «+ Nuovo portafoglio». Provato sugli emulatori con le regole vere: invito → link → registrazione → primo portafoglio.
9. **Assistente AI (fatto, 22/11/2026, PR `assistente`):** pagina Assistente (barra laterale su PC; sul telefono da Altro → Strumenti), stessa chiave Gemini del sito vecchio (`localStorage.gemini_api_key`, stesso dominio), Worker `/chat` invariato. Contesto = `buildAiContext` (posizioni, totali, fiscale dell'anno, minus disponibili, ultimi 25 movimenti; niente nome del conto), domande suggerite, storico della conversazione solo in memoria. Provato fino a Gemini con chiave finta (errore gestito). **Dismissione del sito vecchio:** solo a checklist di parità completata.

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
