// Import dell'esportazione delle transazioni di Trade Republic (CSV): si leggono solo le operazioni sui titoli
// (categoria TRADING), il resto del file (carta, bonifici, interessi) viene ignorato e non si salva.
// Le operazioni si collegano ai movimenti dell'app per ISIN, giorno e importo; il file ha l'ultima parola su
// quantità, prezzo e commissioni (decisione di Andrea, 25/11/2026). Funzioni pure, senza Firebase.

import type { RawAsset, RawTx } from './engine/types.ts'

export interface TrTrade {
  /** transaction_id di Trade Republic: resta nel movimento (`trId`) e rende l'import ripetibile senza doppioni. */
  id: string
  date: string
  side: 'buy' | 'sell'
  isin: string
  name: string
  qty: number
  price: number
  /** Importo pagato o incassato in euro, senza segno. */
  amount: number
  fee: number
  /** Esecuzione di un piano di accumulo (anche il Saveback). */
  savingsPlan: boolean
}

/** Divide una riga CSV con i campi tra virgolette (le virgolette doppie dentro un campo valgono una). */
function splitCsv(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let q = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++ }
      else if (ch === '"') q = false
      else cur += ch
    } else if (ch === '"') q = true
    else if (ch === ',') { out.push(cur); cur = '' }
    else cur += ch
  }
  out.push(cur)
  return out
}

const REQUIRED = ['date', 'category', 'type', 'symbol', 'shares', 'price', 'amount', 'transaction_id']

/** Legge il CSV di Trade Republic e torna solo acquisti e vendite di titoli. Errore chiaro se il file non è quello giusto. */
export function parseTrCsv(text: string): TrTrade[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim())
  const head = splitCsv(lines[0] ?? '').map(h => h.trim())
  const missing = REQUIRED.filter(k => !head.includes(k))
  if (missing.length) throw new Error('Il file non sembra l\'esportazione delle transazioni di Trade Republic (mancano le colonne ' + missing.join(', ') + ').')
  const col = (r: string[], k: string) => r[head.indexOf(k)] ?? ''
  const num = (s: string) => Math.abs(Number(s) || 0)
  const out: TrTrade[] = []
  for (const line of lines.slice(1)) {
    const r = splitCsv(line)
    if (col(r, 'category') !== 'TRADING') continue
    const type = col(r, 'type')
    if (type !== 'BUY' && type !== 'SELL') continue
    const qty = num(col(r, 'shares'))
    const price = num(col(r, 'price'))
    const isin = col(r, 'symbol').trim().toUpperCase()
    if (!(qty > 0) || !isin || !/^\d{4}-\d{2}-\d{2}$/.test(col(r, 'date'))) continue
    if ((col(r, 'currency') || 'EUR').toUpperCase() !== 'EUR') continue
    out.push({
      id: col(r, 'transaction_id'),
      date: col(r, 'date'),
      side: type === 'BUY' ? 'buy' : 'sell',
      isin,
      name: col(r, 'name'),
      qty,
      price,
      amount: num(col(r, 'amount')),
      fee: num(col(r, 'fee')),
      savingsPlan: /^savings plan/i.test(col(r, 'description')),
    })
  }
  return out.sort((a, b) => a.date.localeCompare(b.date))
}

export type TrAction =
  /** Il movimento era una stima: prende i numeri del file. */
  | 'replace'
  /** Movimento già confermato ma con numeri diversi: il file lo corregge. */
  | 'fix'
  /** Nel file ma non nell'app: si aggiunge. */
  | 'new'
  /** Già uguale: nessuna modifica (al massimo si collega l'id di Trade Republic). */
  | 'same'
  /** Titolo che non c'è in questo portafoglio: si ignora. */
  | 'unknown'

export interface TrMatch {
  trade: TrTrade
  action: TrAction
  assetId?: string
  /** Movimento dell'app collegato (posizione nell'elenco del titolo e id). */
  txIndex?: number
  txId?: string
  before?: { date: string; qty: number; price: number; estimated: boolean }
}

export interface TrPlan {
  matches: TrMatch[]
  /** Movimenti dell'app nel periodo del file che il file non contiene (non si toccano: solo segnalati). */
  onlyInApp: { assetId: string; date: string; qty: number; price: number }[]
}

type Asset = RawAsset & { isin?: string }
const DAY = 86400000
const days = (a: string, b: string) => Math.abs(Date.parse(a + 'T12:00:00Z') - Date.parse(b + 'T12:00:00Z')) / DAY
const close = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol

/** Collega le operazioni del file ai movimenti del portafoglio e decide cosa fare di ognuna. */
export function planTrImport(assets: Record<string, Asset>, trades: TrTrade[]): TrPlan {
  const byIsin = new Map<string, string>()
  for (const [id, a] of Object.entries(assets)) if (a?.isin) byIsin.set(a.isin.trim().toUpperCase(), id)

  let matches: TrMatch[] = trades.map(trade => ({ trade, action: 'unknown' as TrAction, assetId: byIsin.get(trade.isin) }))
  const used = new Set<string>() // assetId#indice
  const dropped = new Set<TrMatch>()

  for (const [assetId, a] of Object.entries(assets)) {
    const txs = a?.transactions ?? []
    let mine = matches.filter(m => m.assetId === assetId)
    if (!mine.length) continue
    // Un ordine eseguito in più pezzi (stesso giorno e prezzo) che nell'app è un solo movimento: si uniscono le righe.
    const merge = (group: TrMatch[]): TrMatch => {
      const [first, ...rest] = group
      const sum = (k: 'qty' | 'amount' | 'fee') => Math.round(group.reduce((x, m) => x + m.trade[k], 0) * 1e6) / 1e6
      first!.trade = { ...first!.trade, id: group.map(m => m.trade.id).join('+'), qty: sum('qty'), amount: sum('amount'), fee: sum('fee') }
      for (const m of rest) dropped.add(m)
      mine = mine.filter(m => !dropped.has(m))
      return first!
    }
    txs.forEach(t => {
      const ids = String((t as { trId?: string }).trId ?? '').split('+')
      if (ids.length < 2) return
      const group = ids.map(id => mine.find(m => m.trade.id === id)).filter((m): m is TrMatch => !!m)
      if (group.length === ids.length) merge(group)
    })
    txs.forEach((t, i) => {
      if (!t || (t as { trId?: string }).trId || used.has(`${assetId}#${i}`)) return
      const q = Number(t.qty) || 0
      const same = mine.filter(m => m.txIndex === undefined && m.trade.date === t.date && m.trade.side === t.type)
      if (same.some(m => close(m.trade.qty, q, 1e-6))) return
      for (let x = 0; x < same.length; x++) {
        for (let y = x + 1; y < same.length; y++) {
          const a = same[x]!, b = same[y]!
          if (close(a.trade.price, b.trade.price, 1e-4) && close(a.trade.qty + b.trade.qty, q, 1e-6)) {
            link(merge([a, b]), i)
            return
          }
        }
      }
    })
    function link(m: TrMatch, i: number) {
      used.add(`${assetId}#${i}`)
      m.txIndex = i
      const t = txs[i]!
      m.txId = t.id
      m.before = { date: t.date, qty: Number(t.qty) || 0, price: Number(t.price) || 0, estimated: !!t.priceEstimated }
    }
    // 1) già importate in passato: stesso id di Trade Republic.
    for (const m of mine) {
      const i = txs.findIndex((t, k) => (t as { trId?: string }).trId === m.trade.id && !used.has(`${assetId}#${k}`))
      if (i >= 0) link(m, i)
    }
    // 2) le coppie più vicine per giorno e importo (entro 3 giorni e il 25% dell'importo).
    const pairs: { m: TrMatch; i: number; score: number }[] = []
    for (const m of mine) {
      if (m.txIndex !== undefined) continue
      txs.forEach((t, i) => {
        if (!t || t.type !== m.trade.side || used.has(`${assetId}#${i}`) || (t as { trId?: string }).trId) return
        const d = days(t.date, m.trade.date)
        const amount = (Number(t.qty) || 0) * (Number(t.price) || 0)
        const rel = m.trade.amount > 0 ? Math.abs(amount - m.trade.amount) / m.trade.amount : 1
        if (d <= 3 && rel <= 0.25) pairs.push({ m, i, score: d + rel * 10 })
      })
    }
    pairs.sort((x, y) => x.score - y.score)
    for (const p of pairs) if (p.m.txIndex === undefined && !used.has(`${assetId}#${p.i}`)) link(p.m, p.i)

    for (const m of mine) {
      if (m.txIndex === undefined) m.action = 'new'
      else {
        const b = m.before!
        const t = txs[m.txIndex]!
        const equal = close(b.qty, m.trade.qty, 1e-6) && close(b.price, m.trade.price, 1e-4) && b.date === m.trade.date
          && close(Number(t.commission) || 0, m.trade.fee, 0.005)
        m.action = b.estimated ? 'replace' : equal ? 'same' : 'fix'
      }
    }
  }

  matches = matches.filter(m => !dropped.has(m))
  const dates = trades.map(t => t.date)
  const from = dates[0]
  const to = dates[dates.length - 1]
  const onlyInApp: TrPlan['onlyInApp'] = []
  if (from && to) {
    const isins = new Set(trades.map(t => t.isin))
    for (const [assetId, a] of Object.entries(assets)) {
      if (!a?.isin || !isins.has(a.isin.trim().toUpperCase())) continue
      ;(a.transactions ?? []).forEach((t, i) => {
        if ((t.type === 'buy' || t.type === 'sell') && t.date >= from && t.date <= to && !used.has(`${assetId}#${i}`)) {
          onlyInApp.push({ assetId, date: t.date, qty: Number(t.qty) || 0, price: Number(t.price) || 0 })
        }
      })
    }
  }
  return { matches, onlyInApp }
}

/** Il movimento come lo vuole il file: numeri di Trade Republic, niente più "da confermare". */
export function trTx(m: TrMatch, previous: RawTx | undefined, newId: () => string): RawTx {
  const t = m.trade
  const tx: RawTx & { trId?: string } = {
    ...previous,
    id: previous?.id ?? newId(),
    date: t.date,
    type: t.side,
    qty: t.qty,
    price: t.price,
    commission: t.fee,
    commissionCurrency: 'EUR',
    trId: t.id,
  }
  delete tx.priceEstimated
  if (!previous) {
    tx.source = t.side === 'buy' && t.savingsPlan ? 'pac' : 'traderepublic'
    if (tx.source === 'pac') tx.importoPac = t.amount
  }
  if (previous && (previous.date !== t.date || Number(previous.price) !== t.price)) delete tx.exchangeRate
  return tx
}

/** Applica all'elenco dei movimenti di un titolo le modifiche scelte. Null se nel frattempo l'elenco è cambiato. */
export function applyTrMatches(list: RawTx[], chosen: TrMatch[], newId: () => string): RawTx[] | null {
  const next = [...list]
  const added: RawTx[] = []
  for (const m of chosen) {
    if (m.action === 'new') {
      added.push(trTx(m, undefined, newId))
      continue
    }
    if (m.txIndex === undefined) continue
    const i = m.txId ? next.findIndex(t => t.id === m.txId) : m.txIndex
    const prev = next[i]
    if (!prev || prev.date !== m.before?.date || Number(prev.qty) !== m.before.qty) return null
    next[i] = trTx(m, prev, newId)
  }
  return [...next, ...added].sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * Titoli dell'app senza ISIN che corrispondono a un ISIN del file: quello con più movimenti negli stessi giorni (±3)
 * delle operazioni del file, se almeno la metà coincide. Serve a proporre il collegamento: decide l'utente.
 */
export function suggestIsinLinks(assets: Record<string, Asset>, trades: TrTrade[]): Record<string, string> {
  const known = new Set(Object.values(assets).map(a => a?.isin?.trim().toUpperCase()).filter(Boolean))
  const free = Object.entries(assets).filter(([, a]) => a && !a.isin && (a.transactions ?? []).length)
  const out: Record<string, string> = {}
  const taken = new Set<string>()
  for (const isin of [...new Set(trades.map(t => t.isin))].filter(i => !known.has(i))) {
    const mine = trades.filter(t => t.isin === isin)
    let best: { id: string; hits: number } | null = null
    for (const [id, a] of free) {
      if (taken.has(id)) continue
      const txs = a.transactions ?? []
      const hits = mine.filter(t => txs.some(x => x.type === t.side && days(x.date, t.date) <= 3)).length
      if (!best || hits > best.hits) best = { id, hits }
    }
    if (best && best.hits * 2 >= mine.length) {
      out[isin] = best.id
      taken.add(best.id)
    }
  }
  return out
}

/** Copia dei titoli con gli ISIN scelti dall'utente (`links`: ISIN → id del titolo). */
export function withIsins<T extends Asset>(assets: Record<string, T>, links: Record<string, string>): Record<string, T> {
  const out = { ...assets }
  for (const [isin, id] of Object.entries(links)) if (out[id]) out[id] = { ...out[id], isin }
  return out
}
