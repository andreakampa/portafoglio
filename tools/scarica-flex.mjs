// Scarica il report Flex di IBKR con la configurazione salvata su Firebase (dal backup locale),
// passando dal relay come fa il sito. Salva l'XML in .backup/ (escluso da git: dati personali).
// Uso: node tools/scarica-flex.mjs

import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const DIR = path.join(ROOT, '.backup')
const file = path.join(DIR, fs.readdirSync(DIR).filter(f => f.startsWith('database-')).sort().at(-1))
const user = Object.values(JSON.parse(fs.readFileSync(file, 'utf8')).users)[0]
const { token, queryId, relayUrl } = user.ibkr_config ?? {}
if (!token || !queryId || !relayUrl) throw new Error('Configurazione IBKR incompleta nel backup')

// Il relay accetta solo richieste dal dominio del sito.
const post = async (p, body) =>
  (await fetch(relayUrl.replace(/\/+$/, '') + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://andreakampa.github.io' },
    body: JSON.stringify(body),
  })).json()

const sleep = ms => new Promise(r => setTimeout(r, ms))
const sent = await post('/send', { token, queryId })
if (!sent.ok) throw new Error(`IBKR ha rifiutato la richiesta: ${sent.errorCode} ${sent.errorMessage ?? sent.error}`)
await sleep(5000)
for (let i = 0; i < 10; i++) {
  const got = await post('/get', { token, referenceCode: sent.referenceCode })
  if (got.ok) {
    const out = path.join(DIR, `flex-${new Date().toISOString().slice(0, 10)}.xml`)
    fs.writeFileSync(out, got.xml)
    console.log(`Report salvato: ${out} (${got.xml.length} caratteri)`)
    process.exit(0)
  }
  if (!got.pending) throw new Error(`Download non riuscito: ${got.errorCode} ${got.errorMessage ?? got.error}`)
  await sleep(8000)
}
throw new Error('IBKR non ha preparato il report in tempo')
