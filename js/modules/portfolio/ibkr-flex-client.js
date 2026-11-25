// ibkr-flex-client.js
// Scarica il report Flex tramite il relay (ibkr-relay-worker.js). Restituisce il testo XML,
// da passare a parseFlexXml. Limiti di IBKR: 1 richiesta al secondo e 10 al minuto per token,
// quindi un solo scaricamento per volta e poll distanziati.

export class FlexDownloadError extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}

const MESSAGGI = {
    '1003': 'Il report non è disponibile al momento',
    '1011': 'Il servizio IBKR del tuo account non è attivo',
    '1012': 'Il token è scaduto: generane uno nuovo nel portale IBKR',
    '1013': 'Il token ha una restrizione IP: disattivala nel portale IBKR',
    '1014': 'La Query non è valida: controlla il Query ID',
    '1015': 'Il token non è valido',
    '1017': 'Codice di riferimento non valido',
    '1018': 'Troppe richieste a IBKR: riprova tra qualche minuto',
    '1020': 'Richiesta non valida'
};

export async function downloadFlexReport({
    relayUrl, token, queryId,
    onProgress = () => {},
    firstWaitMs = 4000,
    pollMs = 8000,       // al massimo ~7 richieste al minuto: sotto il limite di 10
    maxPolls = 10,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
}) {
    const base = String(relayUrl || '').replace(/\/+$/, '');
    if (!base) throw new FlexDownloadError('config', 'Indirizzo del relay non configurato');

    const post = async (path, body) => {
        let res;
        try {
            res = await fetch(`${base}${path}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
        } catch {
            throw new FlexDownloadError('rete', 'Relay non raggiungibile: controlla la connessione');
        }
        if (res.status === 403) throw new FlexDownloadError('origin', 'Il relay non autorizza questo sito');
        if (res.status === 429) throw new FlexDownloadError('limite', 'Troppe richieste al relay: riprova tra un minuto');
        if (res.status >= 500) throw new FlexDownloadError('relay', 'IBKR non raggiungibile in questo momento');
        return res.json();
    };

    onProgress('Richiesta del report a IBKR…');
    const sent = await post('/send', { token, queryId });
    if (!sent.ok) {
        throw new FlexDownloadError(sent.errorCode || sent.error || 'invio',
            MESSAGGI[sent.errorCode] || sent.errorMessage || 'IBKR ha rifiutato la richiesta');
    }

    await sleep(firstWaitMs);
    for (let i = 0; i < maxPolls; i++) {
        onProgress(i === 0 ? 'Download del report…' : `Report in preparazione (tentativo ${i + 1})…`);
        const got = await post('/get', { token, referenceCode: sent.referenceCode });
        if (got.ok) return got.xml;
        if (!got.pending) {
            throw new FlexDownloadError(got.errorCode || 'download',
                MESSAGGI[got.errorCode] || got.errorMessage || 'Download del report non riuscito');
        }
        await sleep(pollMs);
    }
    throw new FlexDownloadError('timeout', 'IBKR non ha ancora preparato il report: riprova tra qualche minuto');
}