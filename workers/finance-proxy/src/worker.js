// finance-proxy — Cloudflare Worker del sito Portafoglio Tracker Pro.
//   GET  /?url=<indirizzo>  proxy CORS, SOLO verso i domini in ALLOWED_HOSTS
//   POST /chat              assistente AI (Gemini) con la chiave dell'utente (BYOK, mai salvata)
// Entrambi rispondono solo alle pagine servite dai domini in ALLOWED_ORIGINS (niente localhost:
// in locale la v2 passa dall'inoltro di Vite, vedi app/vite.config.ts) e hanno un limite di
// richieste al minuto per indirizzo IP (binding PROXY_LIMIT e CHAT_LIMIT in wrangler.jsonc).
// Nota: l'origine la può falsificare chiunque fuori dal browser; il limite è la difesa vera.

const ALLOWED_ORIGINS = ['https://andreakampa.github.io', 'https://gruzzolo.pages.dev'];

// Unici domini che il proxy può contattare (quelli usati dal sito)
const ALLOWED_HOSTS = new Set([
  'query1.finance.yahoo.com',
  'query2.finance.yahoo.com',
  'open.er-api.com',
  'tassidicambio.bancaditalia.it',
]);

const isAllowedOrigin = (origin) => ALLOWED_ORIGINS.includes(origin);

const cors = (origin, methods, extra = {}) => ({
  'Access-Control-Allow-Origin': isAllowedOrigin(origin) ? origin : ALLOWED_ORIGINS[0],
  'Access-Control-Allow-Methods': methods,
  'Access-Control-Allow-Headers': 'Content-Type, X-Gemini-Key',
  'Access-Control-Max-Age': '86400',
  Vary: 'Origin',
  ...extra,
});

const json = (origin, methods, obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: cors(origin, methods, { 'Content-Type': 'application/json' }),
  });

// ---- LIMITE DI RICHIESTE ----

// true se la richiesta supera il limite. Chiave = indirizzo IP del client.
// Senza binding (configurazione sbagliata) il limite non si applica ma lo si segnala nei log.
async function overLimit(limiter, request, name) {
  if (!limiter) {
    console.warn(`limite ${name} non configurato`);
    return false;
  }
  const ip = request.headers.get('CF-Connecting-IP') || 'sconosciuto';
  const { success } = await limiter.limit({ key: ip });
  return !success;
}

const tooMany = (origin, methods) =>
  new Response(JSON.stringify({ error: 'troppe_richieste' }), {
    status: 429,
    headers: cors(origin, methods, { 'Content-Type': 'application/json', 'Retry-After': '60' }),
  });

// ---- PROXY ----

async function handleProxy(request, env, origin) {
  const M = 'GET, OPTIONS';
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin, M) });
  if (await overLimit(env.PROXY_LIMIT, request, 'PROXY_LIMIT')) return tooMany(origin, M);
  if (!isAllowedOrigin(origin)) return json(origin, M, { error: 'origine non consentita' }, 403);
  if (request.method !== 'GET') return json(origin, M, { error: 'metodo non consentito' }, 405);

  const raw = new URL(request.url).searchParams.get('url');
  if (!raw) return json(origin, M, { error: 'missing url param' }, 400);

  let target;
  try {
    // Doppia decodifica come nella versione precedente: il sito codifica una volta,
    // e alcuni ticker (es. ^VIX) arrivano già codificati all'interno.
    target = new URL(decodeURIComponent(raw));
  } catch {
    return json(origin, M, { error: 'url non valido' }, 400);
  }
  if (target.protocol !== 'https:' || !ALLOWED_HOSTS.has(target.hostname)) {
    return json(origin, M, { error: 'dominio non consentito' }, 403);
  }

  try {
    const response = await fetch(target.toString(), {
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
      redirect: 'manual', // nessun redirect verso domini non autorizzati
      signal: AbortSignal.timeout(15000),
    });
    const body = await response.text();
    return new Response(body, {
      status: response.status,
      headers: cors(origin, M, { 'Content-Type': 'application/json' }),
    });
  } catch (e) {
    return json(origin, M, { error: e.message }, 500);
  }
}

// ---- AI CHAT (multiutente, BYOK) ----

const SYSTEM_PROMPT = `Sei l'assistente di un tracker di portafoglio personale (investitore italiano).
Rispondi in italiano, in modo conciso, con numeri e tabelle quando utile.
Per pesi, P/L, drawdown e prezzi usa SOLO i dati forniti nel contesto: se un dato manca, dillo.
Non inventare prezzi o notizie. Evidenzia rischi e incertezze: la tua è analisi, non consulenza finanziaria.`;

function callGemini(model, body, key) {
  return fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify(body),
  });
}

async function handleChat(request, env, origin) {
  const M = 'POST, OPTIONS';
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin, M) });
  if (await overLimit(env.CHAT_LIMIT, request, 'CHAT_LIMIT')) return tooMany(origin, M);
  if (request.method !== 'POST') return json(origin, M, { error: 'metodo non consentito' }, 405);
  if (!isAllowedOrigin(origin)) return json(origin, M, { error: 'origine non consentita' }, 403);

  const key = (request.headers.get('X-Gemini-Key') || '').trim();
  if (!/^[A-Za-z0-9._-]{20,300}$/.test(key)) return json(origin, M, { error: 'chiave_mancante' }, 401);

  let p;
  try { p = await request.json(); } catch { return json(origin, M, { error: 'JSON non valido' }, 400); }

  const question = typeof p.question === 'string' ? p.question.trim() : '';
  if (!question || question.length > 2000) return json(origin, M, { error: 'domanda non valida' }, 400);

  const ctx = JSON.stringify(p.context || {}).slice(0, 30000);
  const history = (Array.isArray(p.history) ? p.history : []).slice(-6).map((m) => ({
    role: m.role === 'model' ? 'model' : 'user',
    parts: [{ text: String(m.text || '').slice(0, 2000) }],
  }));

  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [
      ...history,
      { role: 'user', parts: [{ text: `DATI PORTAFOGLIO (JSON):\n${ctx}\n\nDOMANDA: ${question}` }] },
    ],
    generationConfig: { maxOutputTokens: 1500, temperature: 0.4 },
  };

  const models = [env.GEMINI_MODEL || 'gemini-3.5-flash', env.GEMINI_MODEL_FALLBACK].filter(Boolean);
  let lastStatus = 500;
  let lastDetail = '';
  for (const model of models) {
    let r = await callGemini(model, body, key);
    if (r.status === 503) {
      await new Promise((res) => setTimeout(res, 1500));
      r = await callGemini(model, body, key);
    }
    if (r.ok) {
      const data = await r.json();
      const answer = (data.candidates?.[0]?.content?.parts || []).map((x) => x.text || '').join('').trim();
      return json(origin, M, { answer: answer || 'Nessuna risposta dal modello.', model });
    }
    lastStatus = r.status;
    lastDetail = (await r.text().catch(() => '')).slice(0, 300);
    if ([400, 401, 403].includes(r.status)) return json(origin, M, { error: 'chiave_non_valida', status: r.status }, 401);
    if (![404, 429, 500, 503].includes(r.status)) break;
  }
  const quota = lastStatus === 429 ? 'quota_esaurita' : 'gemini_non_disponibile';
  return json(origin, M, { error: quota, status: lastStatus, detail: lastDetail }, 502);
}

// ---- WORKER ----

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const { pathname } = new URL(request.url);
    if (pathname === '/chat') return handleChat(request, env, origin);
    return handleProxy(request, env, origin);
  },
};
