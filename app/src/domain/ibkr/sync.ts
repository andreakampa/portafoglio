// Sincronizzazione automatica: dal report Flex alle modifiche del portafoglio IBKR.
// Regole di sicurezza: mai doppioni (ogni ordine IBKR ha un id), e nel dubbio non si scrive
// ma si segnala ("da controllare"). Il report IBKR vince sui dati inseriti a mano solo quando
// il collegamento è certo (stesso titolo, giorno, tipo e quantità, prezzo entro l'1%).

import type { RawAsset, RawTx } from '../engine/types.ts'
import { yahooTicker, type FlexOrder } from './flex.ts'

export interface SyncPortfolio {
  assets?: Record<string, RawAsset & { isin?: string; commDefault?: number }>
}

export interface SyncResult {
  /** Portafoglio aggiornato (copia): da salvare solo se `changed`. */
  portfolio: SyncPortfolio
  changed: boolean
  added: string[]
  linked: string[]
  review: string[]
  skipped: string[]
}

type Tx = RawTx & { externalId?: string; source?: string }

const base = (t: string) => t.split('.')[0]!.replace(/[a-z]+$/, '').toUpperCase()
const days = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86400000
const label = (o: FlexOrder) => `${o.date} ${o.symbol} ${o.type} ${o.qty} @ ${+o.price.toFixed(4)} ${o.currency}`

export function applyFlexOrders(
  input: SyncPortfolio,
  orders: FlexOrder[],
  newId: () => string,
): SyncResult {
  const portfolio: SyncPortfolio = structuredClone(input)
  const assets = (portfolio.assets ??= {})
  const res: SyncResult = { portfolio, changed: false, added: [], linked: [], review: [], skipped: [] }

  const already = new Set<string>()
  for (const a of Object.values(assets)) for (const t of (a.transactions ?? []) as Tx[]) if (t.externalId) already.add(t.externalId)

  const findAsset = (o: FlexOrder) =>
    Object.entries(assets).find(([, a]) => o.isin && a.isin === o.isin) ??
    Object.entries(assets).find(([, a]) => base(a.ticker || a.nome || '') === base(o.symbol) && (a.valuta || 'EUR').toUpperCase() === o.currency)

  for (const o of orders) {
    if (already.has(o.externalId)) continue
    if (o.type === 'misto') {
      res.review.push(`${label(o)}: apre e chiude insieme, va diviso a mano`)
      continue
    }

    let hit = findAsset(o)
    if (!hit) {
      const ticker = yahooTicker(o.symbol, o.listingExchange)
      if (!ticker) {
        res.review.push(`${label(o)}: titolo nuovo su un mercato non riconosciuto (${o.listingExchange})`)
        continue
      }
      const id = 'ID' + newId()
      assets[id] = { nome: ticker, ticker, isin: o.isin, valuta: o.currency, tipoAsset: 'stock', commDefault: 0, transactions: [] }
      hit = [id, assets[id]!]
    }
    const [, asset] = hit
    const txs = (asset.transactions ??= []) as Tx[]
    const exact = { price: o.price, commission: o.commission, commissionCurrency: o.commissionCurrency, ...(o.exchangeRate ? { exchangeRate: o.exchangeRate } : {}) }

    // Movimento inserito a mano che è sicuramente questo ordine: lo si collega e corregge.
    const manual = txs.filter(t => !t.externalId)
    const sure = manual.find(t => t.type === o.type && t.date === o.date && Math.abs(+t.qty - o.qty) < 1e-6 && Math.abs(+t.price / o.price - 1) <= 0.01)
    if (sure) {
      Object.assign(sure, exact, { externalId: o.externalId })
      res.linked.push(label(o))
      res.changed = true
      continue
    }
    // Qualcosa di simile ma non uguale (data, tipo o prezzo diversi): meglio non creare doppioni.
    const similar = manual.find(
      t =>
        (days(t.date, o.date) <= 3 && Math.abs(+t.qty - o.qty) < 1e-6) || // stessa quantità, data vicina
        (t.date === o.date && t.type === o.type), // stesso giorno e tipo, quantità diversa
    )
    if (similar) {
      res.review.push(`${label(o)}: simile al movimento inserito a mano del ${similar.date} (${similar.type} ${similar.qty} @ ${similar.price})`)
      continue
    }

    txs.push({ id: newId(), externalId: o.externalId, source: 'ibkr', date: o.date, type: o.type, qty: o.qty, ...exact })
    txs.sort((a, b) => a.date.localeCompare(b.date))
    res.added.push(label(o))
    res.changed = true
  }
  return res
}
