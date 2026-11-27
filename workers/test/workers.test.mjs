// Test dei Worker Cloudflare (origini consentite, limite di richieste, domini del proxy).
// Si lanciano dalla radice con: npm run test:workers  (Node puro, nessuna dipendenza)
import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import proxy, { readAnswer, thinkingConfig } from '../finance-proxy/src/worker.js'
import relay from '../ibkr-relay/src/worker.js'

const SITE = 'https://andreakampa.github.io'
const PROXY = 'https://finance-proxy.example.dev'
const RELAY = 'https://ibkr-relay.example.dev'

/** Limitatore finto con la stessa interfaccia del binding Cloudflare: `limit` richieste per chiave. */
function fakeLimiter(limit) {
  const counts = new Map()
  return {
    keys: counts,
    async limit({ key }) {
      const n = (counts.get(key) ?? 0) + 1
      counts.set(key, n)
      return { success: n <= limit }
    },
  }
}

const req = (url, { origin, ip = '1.2.3.4', method = 'GET', headers = {}, body } = {}) =>
  new Request(url, {
    method,
    headers: { ...(origin ? { Origin: origin } : {}), 'CF-Connecting-IP': ip, ...headers },
    body,
  })

const yahoo = `${PROXY}/?url=${encodeURIComponent('https://query1.finance.yahoo.com/v8/finance/chart/AAPL')}`

// Niente rete vera: fetch restituisce sempre una risposta finta e ricorda gli indirizzi chiamati.
let called
const realFetch = globalThis.fetch
const realWarn = console.warn
beforeEach(() => {
  called = []
  globalThis.fetch = async (url) => {
    called.push(String(url))
    return new Response('{"ok":true}', { status: 200 })
  }
  console.warn = () => {}
})
afterEach(() => {
  globalThis.fetch = realFetch
  console.warn = realWarn
})

describe('finance-proxy: origini', () => {
  const env = () => ({ PROXY_LIMIT: fakeLimiter(100), CHAT_LIMIT: fakeLimiter(100) })

  it('accetta il sito pubblicato', async () => {
    const r = await proxy.fetch(req(yahoo, { origin: SITE }), env())
    assert.equal(r.status, 200)
    assert.equal(r.headers.get('Access-Control-Allow-Origin'), SITE)
    assert.equal(called.length, 1)
  })

  it('accetta anche miogruzzolo.pages.dev', async () => {
    const r = await proxy.fetch(req(yahoo, { origin: 'https://miogruzzolo.pages.dev' }), env())
    assert.equal(r.status, 200)
    assert.equal(r.headers.get('Access-Control-Allow-Origin'), 'https://miogruzzolo.pages.dev')
  })

  for (const origin of ['http://localhost:5173', 'http://127.0.0.1:8080', 'https://evil.example', '']) {
    it(`rifiuta l'origine "${origin || '(nessuna)'}"`, async () => {
      const r = await proxy.fetch(req(yahoo, { origin }), env())
      assert.equal(r.status, 403)
      assert.notEqual(r.headers.get('Access-Control-Allow-Origin'), origin)
      assert.equal(called.length, 0)
    })
  }

  it('rifiuta localhost anche su /chat', async () => {
    const r = await proxy.fetch(
      req(`${PROXY}/chat`, { origin: 'http://localhost:5173', method: 'POST', headers: { 'X-Gemini-Key': 'k'.repeat(30) }, body: '{}' }),
      env(),
    )
    assert.equal(r.status, 403)
    assert.equal(called.length, 0)
  })

  it('contatta solo i domini consentiti', async () => {
    const bad = `${PROXY}/?url=${encodeURIComponent('https://example.com/x')}`
    const r = await proxy.fetch(req(bad, { origin: SITE }), env())
    assert.equal(r.status, 403)
    assert.equal(called.length, 0)
  })
})

describe('finance-proxy: limite di richieste', () => {
  it('oltre il limite risponde 429 senza contattare Yahoo', async () => {
    const env = { PROXY_LIMIT: fakeLimiter(3), CHAT_LIMIT: fakeLimiter(3) }
    for (let i = 0; i < 3; i++) assert.equal((await proxy.fetch(req(yahoo, { origin: SITE }), env)).status, 200)
    const r = await proxy.fetch(req(yahoo, { origin: SITE }), env)
    assert.equal(r.status, 429)
    assert.equal(r.headers.get('Retry-After'), '60')
    assert.equal(r.headers.get('Access-Control-Allow-Origin'), SITE) // il sito legge l'errore
    assert.deepEqual(await r.json(), { error: 'troppe_richieste' })
    assert.equal(called.length, 3)
  })

  it('conta per indirizzo IP', async () => {
    const env = { PROXY_LIMIT: fakeLimiter(1), CHAT_LIMIT: fakeLimiter(1) }
    assert.equal((await proxy.fetch(req(yahoo, { origin: SITE, ip: '1.1.1.1' }), env)).status, 200)
    assert.equal((await proxy.fetch(req(yahoo, { origin: SITE, ip: '2.2.2.2' }), env)).status, 200)
    assert.equal((await proxy.fetch(req(yahoo, { origin: SITE, ip: '1.1.1.1' }), env)).status, 429)
  })

  it('conta anche le richieste con origine falsa o sbagliata', async () => {
    const env = { PROXY_LIMIT: fakeLimiter(1), CHAT_LIMIT: fakeLimiter(1) }
    assert.equal((await proxy.fetch(req(yahoo, { origin: 'https://evil.example' }), env)).status, 403)
    assert.equal((await proxy.fetch(req(yahoo, { origin: SITE }), env)).status, 429)
  })

  it('non conta le richieste preliminari OPTIONS', async () => {
    const env = { PROXY_LIMIT: fakeLimiter(1), CHAT_LIMIT: fakeLimiter(1) }
    for (let i = 0; i < 3; i++) assert.equal((await proxy.fetch(req(yahoo, { origin: SITE, method: 'OPTIONS' }), env)).status, 204)
    assert.equal(env.PROXY_LIMIT.keys.size, 0)
  })

  it('/chat ha un limite separato', async () => {
    const env = { PROXY_LIMIT: fakeLimiter(100), CHAT_LIMIT: fakeLimiter(1) }
    const chat = () =>
      proxy.fetch(
        req(`${PROXY}/chat`, { origin: SITE, method: 'POST', headers: { 'X-Gemini-Key': 'k'.repeat(30) }, body: '{"question":""}' }),
        env,
      )
    assert.equal((await chat()).status, 400) // domanda vuota, ma la richiesta è contata
    assert.equal((await chat()).status, 429)
    assert.equal((await proxy.fetch(req(yahoo, { origin: SITE }), env)).status, 200)
  })
})

describe('ibkr-relay', () => {
  const send = (origin, env, ip) =>
    relay.fetch(
      req(`${RELAY}/send`, { origin, ip, method: 'POST', body: JSON.stringify({ token: 'abcdefgh12', queryId: '123456' }) }),
      env,
    )

  it('rifiuta localhost e altri siti', async () => {
    for (const origin of ['http://localhost:5173', 'http://127.0.0.1:5173', 'https://evil.example', '']) {
      assert.equal((await send(origin, { RELAY_LIMIT: fakeLimiter(10) })).status, 403)
    }
    assert.equal(called.length, 0)
  })

  it('accetta il sito e oltre il limite risponde 429', async () => {
    const env = { RELAY_LIMIT: fakeLimiter(2) }
    assert.equal((await send(SITE, env)).status, 200)
    assert.equal((await send(SITE, env)).status, 200)
    const r = await send(SITE, env)
    assert.equal(r.status, 429)
    assert.equal(r.headers.get('Access-Control-Allow-Origin'), SITE)
    assert.equal(called.length, 2)
    assert.ok(called.every(u => u.startsWith('https://ndcdyn.interactivebrokers.com/')))
  })
})

describe('finance-proxy: risposte di Gemini', () => {
  const env = () => ({ PROXY_LIMIT: fakeLimiter(100), CHAT_LIMIT: fakeLimiter(100) })
  const ask = () =>
    proxy.fetch(
      req(`${PROXY}/chat`, { origin: SITE, method: 'POST', headers: { 'X-Gemini-Key': 'k'.repeat(30) }, body: '{"question":"Analizza"}' }),
      env(),
    )
  const gemini = (data) => {
    const sent = []
    globalThis.fetch = async (url, init) => {
      sent.push(JSON.parse(init.body))
      return new Response(JSON.stringify(data), { status: 200 })
    }
    return sent
  }

  it('unisce tutte le parti e salta i pensieri', () => {
    const r = readAnswer({
      candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'ragiono…', thought: true }, { text: 'Prima parte, ' }, { text: 'seconda parte.' }] } }],
    })
    assert.deepEqual(r, { answer: 'Prima parte, seconda parte.', truncated: false })
  })

  it('segnala le risposte interrotte, vuote o bloccate', () => {
    assert.equal(readAnswer({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: 'a metà' }] } }] }).truncated, true)
    assert.equal(readAnswer({ candidates: [{ finishReason: 'MAX_TOKENS', content: {} }] }).reason, 'troppo_lunga')
    assert.equal(readAnswer({ promptFeedback: { blockReason: 'SAFETY' } }).reason, 'bloccata')
    assert.equal(readAnswer(null).reason, 'vuota')
  })

  it('ragionamento contenuto con il parametro giusto per ogni modello', () => {
    assert.deepEqual(thinkingConfig('gemini-3.5-flash'), { thinkingLevel: 'low' })
    assert.deepEqual(thinkingConfig('gemini-2.5-flash'), { thinkingBudget: 1024 })
    assert.equal(thinkingConfig('gemini-2.0-flash'), undefined)
  })

  it('chiede a Gemini abbastanza spazio per rispondere per intero', async () => {
    const sent = gemini({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'Ciao' }] } }] })
    const r = await ask()
    assert.equal(r.status, 200)
    assert.deepEqual(await r.json(), { answer: 'Ciao', truncated: false, model: 'gemini-3.5-flash' })
    assert.ok(sent[0].generationConfig.maxOutputTokens >= 8192)
    assert.deepEqual(sent[0].generationConfig.thinkingConfig, { thinkingLevel: 'low' })
  })

  it('se il modello rifiuta il parametro sul ragionamento, riprova senza', async () => {
    const sent = []
    globalThis.fetch = async (url, init) => {
      const b = JSON.parse(init.body)
      sent.push(b)
      if (b.generationConfig.thinkingConfig) return new Response('{"error":{"code":400}}', { status: 400 })
      return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'Ok' }] } }] }), { status: 200 })
    }
    const r = await ask()
    assert.equal(r.status, 200)
    assert.equal(sent.length, 2)
    assert.equal(sent[1].generationConfig.thinkingConfig, undefined)
  })

  it('una risposta vuota diventa un errore chiaro, non un messaggio a metà', async () => {
    gemini({ candidates: [{ finishReason: 'MAX_TOKENS', content: {} }] })
    const r = await ask()
    assert.equal(r.status, 502)
    assert.equal((await r.json()).error, 'risposta_troppo_lunga')
  })
})
