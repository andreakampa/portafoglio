// Aggiunge al portafoglio IBKR le opzioni del report Flex dell'anno che non ci sono ancora (21/11/2026: la call BMEA del 26/08).
// Uso: node --experimental-strip-types tools/opzioni-ibkr-storico.mjs <database.json> <flex.xml> [--patch out.json]
// Scrive solo titoli NUOVI (percorso assets/<id>) o movimenti nuovi in coda; applicare con:
//   firebase database:update /users/<uid>/portfolio_state/portfolios/<id> out.json
import fs from 'node:fs'
import { parseFlex } from '../app/src/domain/ibkr/flex.ts'
import { applyFlexOrders } from '../app/src/domain/ibkr/sync.ts'

const [dbFile, xmlFile, flag, patchFile] = process.argv.slice(2)
const db = JSON.parse(fs.readFileSync(dbFile, 'utf8'))
const [uid, user] = Object.entries(db.users)[0]
const pid = user.ibkr_config.portfolioId
const before = user.portfolio_state.portfolios[pid]
const report = parseFlex(fs.readFileSync(xmlFile, 'utf8'))
const orders = report.orders.filter(o => o.assetCategory === 'OPT')
const res = applyFlexOrders(before, orders, () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8))

const patch = {}
for (const [id, a] of Object.entries(res.portfolio.assets ?? {})) {
  const old = before.assets?.[id]
  if (!old) patch[`assets/${id}`] = a
  else if ((a.transactions?.length ?? 0) !== (old.transactions?.length ?? 0)) patch[`assets/${id}/transactions`] = a.transactions
}
console.log(`Opzioni nel report: ${orders.length} ordini. Aggiunti: ${res.added.length}, da controllare: ${res.review.length}`)
res.added.forEach(l => console.log('  +', l))
res.review.forEach(l => console.log('  ?', l))
console.log(JSON.stringify(patch, null, 1))
if (flag === '--patch') {
  fs.writeFileSync(patchFile, JSON.stringify(patch, null, 1))
  console.log(`\nApplica con: firebase database:update /users/${uid}/portfolio_state/portfolios/${pid} ${patchFile}`)
}
