// Informativa privacy per chi viene invitato (piano di cifratura, passo 6). Testo semplice, da aggiornare se cambia
// qualcosa su dove stanno i dati (Firebase, Cloudflare, GitHub Pages) o su chi può leggerli.

export const PRIVACY_UPDATED = '26 novembre 2026'

export function PrivacyText() {
  return (
    <div className="privacy">
      <p className="muted small">Aggiornata il {PRIVACY_UPDATED}.</p>

      <h3>Chi gestisce il sito</h3>
      <p>
        Gruzzolo è un sito personale di Andrea, aperto gratis solo a chi riceve un suo invito. Non è un servizio commerciale,
        non c'è pubblicità e i dati non vengono venduti né usati per altro. Per qualsiasi domanda o richiesta scrivi direttamente ad Andrea.
      </p>

      <h3>Quali dati e chi può leggerli</h3>
      <ul>
        <li>
          <b>Portafogli, movimenti, prezzi di carico, fiscale, note, piani PAC e impostazioni</b>: vengono <b>cifrati sul tuo dispositivo</b> prima
          di partire. Sul server arrivano illeggibili e si aprono solo con la tua chiave, che nasce dalla tua password. Né Andrea né Google possono leggerli.
        </li>
        <li>
          <b>Email</b> e <b>data di iscrizione</b>: servono per l'accesso e per avvisarti (sospensione, chiusura del sito). Andrea le vede.
        </li>
        <li>
          <b>Password</b>: la gestisce Google (Firebase Authentication). Nessuno la può leggere, nemmeno Andrea.
        </li>
        <li>
          <b>Watchlist e soglie degli avvisi</b> (es. "avvisami se AAPL scende sotto 180") e l'iscrizione alle notifiche del dispositivo: restano
          leggibili, perché un programma sul server deve controllarle ogni 15 minuti per mandarti le notifiche anche ad app chiusa.
          Non contengono quantità né importi.
        </li>
        <li>
          <b>Dati tecnici</b>: come ogni sito, i fornitori qui sotto possono registrare indirizzo IP e orari delle richieste per sicurezza e funzionamento.
        </li>
      </ul>

      <h3>Dove stanno</h3>
      <ul>
        <li><b>Google Firebase</b>, server in Belgio (Unione Europea): account e dati (questi ultimi cifrati).</li>
        <li><b>Cloudflare</b>: passano di qui le richieste dei prezzi dei titoli (vede quali titoli, non quanti ne hai) e il controllo delle soglie per le notifiche.</li>
        <li><b>GitHub Pages</b>: ospita le pagine del sito, non i tuoi dati.</li>
        <li>
          <b>Assistente AI</b>: solo se lo usi tu, con una chiave Gemini tua. Quello che scegli di mandare va a Google Gemini, senza passare da Andrea.
        </li>
      </ul>

      <h3>Per quanto tempo</h3>
      <ul>
        <li>Finché sei iscritto. Puoi cancellare tutto quando vuoi da Impostazioni → <b>Elimina il mio account</b>: si cancella subito.</li>
        <li>
          Se Andrea sospende il tuo accesso, vedi un avviso a ogni accesso, puoi solo consultare i dati e hai <b>30 giorni</b> per scaricarli;
          poi vengono cancellati.
        </li>
        <li>Se il sito chiude, l'avviso arriva via email e nell'app almeno <b>60 giorni</b> prima; poi tutti i dati vengono cancellati.</li>
        <li>Le copie di sicurezza del database contengono i tuoi dati solo cifrati.</li>
      </ul>

      <h3>I tuoi diritti</h3>
      <ul>
        <li><b>Copia dei dati</b>: Impostazioni → Scarica i miei dati (file completo e leggibile).</li>
        <li><b>Correzione</b>: modifichi tutto direttamente nell'app.</li>
        <li><b>Cancellazione</b>: Impostazioni → Elimina il mio account.</li>
        <li>Per tutto il resto scrivi ad Andrea. Puoi anche rivolgerti al Garante per la protezione dei dati personali.</li>
      </ul>

      <h3>Chiave di recupero</h3>
      <p>
        Alla registrazione ricevi una chiave di recupero. Se dimentichi la password è l'<b>unico</b> modo per riaprire i tuoi dati:
        nessuno può recuperarli al posto tuo. Conservala in un posto sicuro e non darla a nessuno.
      </p>
    </div>
  )
}
