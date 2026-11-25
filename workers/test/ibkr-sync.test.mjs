// ibkr-sync: con l'interruttore dell'app spento non scarica nulla da IBKR e segna la pausa.
// Si lancia con npm run test:workers (insieme agli altri test dei Worker).
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { sync } from '../ibkr-sync/src/worker.js'

const env = { EMULATOR: '1', DB_URL: 'http://db.test', UID: 'u1', PORTFOLIO_ID: 'P1', IBKR_TOKEN: 't', IBKR_QUERY_ID: 'q' }
const realFetch = globalThis.fetch

describe('ibkr-sync: interruttore "scarica ogni mattina"', () => {
  afterEach(() => { globalThis.fetch = realFetch })

  it('in pausa: nessuna chiamata a IBKR, scrive lo stato con portfolioId', async () => {
    const calls = []
    globalThis.fetch = async (url, init = {}) => {
      calls.push({ url: String(url), method: init.method ?? 'GET', body: init.body })
      if (String(url).includes('/settings/ibkrAutoSync.json')) return new Response('false')
      return new Response('null')
    }
    const r = await sync(env)
    assert.equal(r.paused, true)
    assert.equal(r.portfolioId, 'P1')
    assert.ok(!calls.some(c => c.url.includes('interactivebrokers')), 'non deve chiamare IBKR')
    const put = calls.find(c => c.method === 'PUT')
    assert.equal(put.url, 'http://db.test/users/u1/ibkr_sync.json')
    assert.equal(JSON.parse(put.body).paused, true)
  })

  it('attivo (valore assente): prova a scaricare da IBKR', async () => {
    const calls = []
    globalThis.fetch = async url => {
      calls.push(String(url))
      if (String(url).includes('interactivebrokers')) return new Response('<FlexStatementResponse><Status>Fail</Status><ErrorCode>1020</ErrorCode></FlexStatementResponse>')
      return new Response('null')
    }
    await assert.rejects(sync(env), /IBKR SendRequest/)
    assert.ok(calls.some(u => u.includes('interactivebrokers')))
  })
})
