# Regole fiscali applicate dal motore

Riferimento per `app/src/domain/engine/`. Persona fisica residente in Italia, fuori dal regime
d'impresa. Ricerca aggiornata a novembre 2026. **Non è consulenza fiscale**: i punti segnati come
incerti vanno verificati con un commercialista prima di usarli in dichiarazione.

## Plus e minusvalenze (redditi diversi, art. 67-68 TUIR)

| Regola | Come la applica il motore | File |
|---|---|---|
| Plus su azioni, ETC/ETN, derivati, short: imposta sostitutiva 26% | `taxRateFor` / `baseRate` | `fiscal.ts` |
| Titoli di Stato e white list: plus e minus contano per il 48,08%, poi 26% (= 12,5% effettivo) | `BOND_WEIGHT` sulla base imponibile e sulle minus | `fiscal.ts` |
| Cripto-attività: 33% dal 1° gennaio 2026 (26% per gli euro-stablecoin MiCA), nessuna franchigia | aliquota 33%, cassetto separato | `fiscal.ts` |
| Minus usabili fino al 31/12 del 4° anno successivo a quello di realizzo | `YEARS_CARRY_FORWARD = 4` | `fiscal.ts` |
| Si usano prima le minus più vecchie | ordinamento dei cassetti per anno | `fiscal.ts` |
| Plus di ETF e fondi (OICR) = redditi di capitale: **non** si compensano con le minus | `plusNotCompensable` (`etf`, `fondo`) | `fiscal.ts` |
| Minus di ETF e fondi = redditi diversi: alimentano il cassetto | trattate come le altre minus | `fiscal.ts` |
| Costo fiscale in EUR al cambio del giorno di ogni operazione: l'effetto cambio fa parte della plus | `fx.ts`, `positions.ts` | |

### Regime amministrato (banca italiana sostituto d'imposta)
- **Costo medio ponderato** per calcolare la plus.
- **Ordine cronologico:** una minus si scomputa dalle plus delle **operazioni successive**, nello stesso anno e nei 4 seguenti. Una minus non restituisce le imposte già trattenute su plus precedenti.
- Compensazione solo **all'interno dello stesso rapporto** (stesso intermediario). Per questo ogni portafoglio ha un cassetto suo.
- Alla chiusura del rapporto la banca rilascia la **certificazione delle minus** (art. 6, c. 5, d.lgs. 461/1997), usabile in un altro amministrato o in dichiarazione. Le minus non passano da sole da un portafoglio all'altro.

### Regime dichiarativo (broker estero, es. IBKR)
- **LIFO** (ultimo acquistato, primo venduto), salvo lotti indicati esplicitamente.
- Nel **quadro RT** plus e minus dello **stesso anno** si sommano tutte, a prescindere dall'ordine. Poi si sottraggono le minus degli anni precedenti, prima le più vecchie.
- Le imposte si versano con F24 a saldo (giugno).

## Imposte patrimoniali (`wealthTax.ts`)

| Imposta | Dove | Quanto |
|---|---|---|
| Imposta di bollo | prodotti finanziari presso intermediario italiano | 2‰ annuo del valore, rapportato ai giorni; la versa l'intermediario |
| IVAFE | prodotti finanziari presso intermediario estero | 2‰ annuo (4‰ nei paradisi fiscali), rapportato ai giorni; in dichiarazione |
| IVAFE conti esteri | conto corrente estero | 34,20 € fissi l'anno |

## Dividendi (non ancora nel nuovo motore)
- **Amministrato:** la banca trattiene il 26% sul dividendo già al netto della ritenuta estera (USA 15% con W-8BEN).
- **Dichiarativo (quadro RM):** 26% sull'importo lordo. Il credito per la ritenuta estera sull'imposta sostitutiva in genere non spetta, ma il punto è controverso: vedi sotto.

## Dichiarazione dei redditi (`taxReturn.ts`, pagina Fiscale → Prospetto)
Fonte: istruzioni Redditi PF 2026, Fascicolo 2 (anno d'imposta 2025). Nel 730 i quadri corrispondenti sono T, M e W.
- **Quadro RT, sezione II-A (26%)**: RT11 col. 1 totale corrispettivi, col. 2 totale costi (titoli di Stato e white list al 48,08%); RT52 col. 2 plus o col. 1 minus;
  RT13 minus degli anni precedenti (da RT101/RT102 della dichiarazione prima), con RT71 col. 3 non oltre la plus; RT72 imponibile, RT73 imposta 26%, RT74 = RT73 − RT15;
  RT102 minus residue per anno e col. 5 quella dell'anno. Codice tributo F24: 1100.
- **Quadro RM, rigo RM31** (redditi di capitale esteri senza intermediario italiano): col. 1 lettera (B proventi OICR esteri armonizzati, anche la plus da vendita;
  C prestito titoli garantito; G interessi di conti esteri; H dividendi), col. 2 codice Stato, col. 3 lordo prima delle ritenute estere, col. 4 aliquota, col. 8 imposta.
  Un rigo per tipo e Stato. Per i dividendi (H) niente opzione ordinaria; col. 5 è il credito IVCA, non la ritenuta estera.
- **Quadro RW**: col. 1 titolo (1 proprietà), col. 3 codice bene (1 conto corrente, 2 partecipazioni, 20 conto deposito titoli), col. 4 Stato, col. 5 quota, col. 6 criterio
  (1 mercato), col. 7 valore iniziale (1/1 o primo giorno), col. 8 valore finale (31/12 o ultimo giorno; per i conti la giacenza media), col. 10 giorni, col. 14 quadri compilati,
  col. 29/30 IVAFE, rigo RW6 col. 1 totale IVAFE. Prodotti con stesso codice e Stato si possono aggregare in un rigo (giorni = media pesata) conservando il prospetto dei singoli.
  Titoli venduti: LIFO. Cambio: **medio mensile** del provvedimento dell'Agenzia (= medie mensili Banca d'Italia). Conto corrente: 34,20 € solo se la giacenza media supera 5.000 €;
  monitoraggio solo sopra 15.000 € di valore massimo.

## Punti incerti, da verificare
1. **Short:** trattati come redditi diversi al 26%, come le altre plus da titoli. Non ho trovato fonti specifiche; manca anche la gestione dei dividendi pagati sul titolo preso in prestito.
2. **Crypto:** le minus crypto compensano plus non crypto (e viceversa)? Il motore le tiene separate (scelta prudente).
3. **Credito per le ritenute estere sui dividendi in dichiarativo:** fonti discordanti, c'è giurisprudenza recente.
4. **IVAFE sul conto corrente estero:** le istruzioni 2026 confermano l'esenzione sotto i 5.000 € di giacenza media (resta da conoscere la giacenza vera del conto IBKR).
5. **Riforma dei redditi finanziari** (legge delega 111/2023, art. 5): potrebbe unificare redditi di capitale e diversi, permettendo di compensare le plus degli ETF. A novembre 2026 non risulta approvata.
6. **Cambio per plus e dividendi:** Banca d'Italia del giorno (base del prospetto) o cambio effettivo IBKR: differenza piccola, va scelto uno e usato sempre.

## Fonti consultate
- [Art. 6 d.lgs. 461/1997](https://www.doctrine.it/norms/laws/itatextqbhgqma8x7vre9/articles/itaartzn3mqxyoticjl1), [certificazioni di minusvalenza](https://www.tassetrading.it/le-certificazioni-di-minusvalenza-art-6-comma-5-d-lgs-461-97-cosa-sono-e-come-utilizzarle/), [recupero minus in amministrato](https://www.tassetrading.it/recupero-minusvalenze-in-regime-amministrato/)
- [Tassazione ETF 2026](https://blog.moneyviz.it/tassazione-etf-2026-plusvalenze-minusvalenze-730-modello-redditi/), [ETF armonizzati e non](https://www.tassetrading.it/tasse-etf/)
- [Cripto 2026 – Fisco Oggi](https://www.fiscooggi.it/portale/-/bilancio-2026-aliquota-pi%C3%B9-leggera-per-le-criptoattivit%C3%A0-in-euro), [Agenda Digitale](https://www.agendadigitale.eu/documenti/tassazione-cripto-attivita-2026-cosa-cambia-su-plusvalenze-permute-e-isee/)
- [IVAFE 2026 – Fiscomania](https://fiscomania.com/ivafe-attivita-finanziarie-estere/), [bollo e IVAFE](https://fiscomania.com/imposta-bollo-strumenti-finanziari/)
- [Titoli di Stato 48,08%](https://fiscomania.com/tassazione-titoli-stato/)
- [Dividendi USA](https://fiscoinvestimenti.it/dividendi-usa-tassazione-calcolo-completo/), [dividendi esteri](https://fiscomania.com/dividendi-esteri-regime-tassazione/)
- [Legge di bilancio 2026: dividendi e plusvalenze](https://www.we-wealth.com/news/dividendi-plusvalenze-stretta-fiscale-2026) (le novità riguardano le imprese, non le persone fisiche)
