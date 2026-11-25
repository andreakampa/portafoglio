// ibkr-relay-worker.js
// Cloudflare Worker SEPARATO da quello di Yahoo. Non salva nulla: inoltra a IBKR le due chiamate
// del Flex Web Service (il browser non può farlo da solo, IBKR non abilita il CORS).
//   POST /send  { token, queryId }        -> { ok, referenceCode } oppure { ok:false, errorCode, errorMessage }
//   POST /get   { token, referenceCode }  -> { ok, xml } | { ok:false, pending:true } | { ok:false, errorCode, ... }
// Il token viaggia nel corpo della POST (non nell'URL) e non viene mai scritto nei log.
// Limite di richieste al minuto per indirizzo IP: binding RELAY_LIMIT in wrangler.jsonc.

// Domini del sito autorizzati a usare il relay (aggiungi qui eventuali altri domini; niente localhost)
const ALLOWED_ORIGINS = ['https://andreakampa.github.io'];

const IBKR_BASE = 'https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService';
// Errori IBKR che significano "riprova tra poco" (non sono veri errori)
const RETRIABLE = new Set(['1001', '1004', '1005', '1019', '1021']);

const isAllowed = (origin) => ALLOWED_ORIGINS.includes(origin);

const corsFor = (origin) => ({
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin'
});

const reply = (obj, status, headers) => new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers }
});

const tag = (xml, name) => {
    const m = new RegExp(`<${name}>([^<]*)</${name}>`).exec(xml);
    return m ? m[1].trim() : '';
};

async function callIbkr(path, params) {
    // L'host è fisso: il client non può far inoltrare richieste altrove
    const url = `${IBKR_BASE}/${path}?${new URLSearchParams({ ...params, v: '3' })}`;
    const res = await fetch(url, {
        headers: { 'User-Agent': 'portafoglio-tracker/1.0' },
        signal: AbortSignal.timeout(25000)
    });
    return res.text();
}

export default {
    async fetch(request, env = {}) {
        const origin = request.headers.get('Origin') || '';
        if (!isAllowed(origin)) return reply({ ok: false, error: 'origin-non-consentito' }, 403, {});
        const cors = corsFor(origin);

        if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
        if (env.RELAY_LIMIT) {
            const ip = request.headers.get('CF-Connecting-IP') || 'sconosciuto';
            const { success } = await env.RELAY_LIMIT.limit({ key: ip });
            if (!success) return reply({ ok: false, error: 'troppe-richieste' }, 429, { ...cors, 'Retry-After': '60' });
        } else {
            console.warn('limite RELAY_LIMIT non configurato');
        }
        if (request.method !== 'POST') return reply({ ok: false, error: 'usa-POST' }, 405, cors);

        let body;
        try { body = await request.json(); } catch { return reply({ ok: false, error: 'json-non-valido' }, 400, cors); }

        const token = String(body.token || '').trim();
        if (!/^[A-Za-z0-9]{8,64}$/.test(token)) return reply({ ok: false, error: 'token-non-valido' }, 400, cors);

        const path = new URL(request.url).pathname.replace(/\/+$/, '');
        try {
            if (path.endsWith('/send')) {
                const queryId = String(body.queryId || '').trim();
                if (!/^\d{3,12}$/.test(queryId)) return reply({ ok: false, error: 'query-id-non-valido' }, 400, cors);
                const xml = await callIbkr('SendRequest', { t: token, q: queryId });
                if (tag(xml, 'Status') === 'Success') {
                    return reply({ ok: true, referenceCode: tag(xml, 'ReferenceCode') }, 200, cors);
                }
                return reply({ ok: false, errorCode: tag(xml, 'ErrorCode'), errorMessage: tag(xml, 'ErrorMessage') }, 200, cors);
            }

            if (path.endsWith('/get')) {
                const ref = String(body.referenceCode || '').trim();
                if (!/^\d{3,40}$/.test(ref)) return reply({ ok: false, error: 'codice-non-valido' }, 400, cors);
                const text = await callIbkr('GetStatement', { t: token, q: ref });
                if (text.includes('<FlexQueryResponse')) return reply({ ok: true, xml: text }, 200, cors);
                const code = tag(text, 'ErrorCode');
                return reply({ ok: false, pending: RETRIABLE.has(code), errorCode: code, errorMessage: tag(text, 'ErrorMessage') }, 200, cors);
            }

            return reply({ ok: false, error: 'percorso-sconosciuto' }, 404, cors);
        } catch {
            return reply({ ok: false, error: 'ibkr-non-raggiungibile' }, 502, cors);
        }
    }
};