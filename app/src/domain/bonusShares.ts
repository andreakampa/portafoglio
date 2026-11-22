// Azioni premio del broker (es. IBKR: azioni assegnate come premio per i versamenti di liquidità, che maturano
// dopo un anno e fino ad allora possono essere riprese). Regola applicata (vedi docs/regole-fiscali.md):
// - il reddito nasce alla MATURAZIONE (vesting), al valore di quel giorno: prima le azioni non sono davvero del cliente;
// - è un reddito di capitale estero (premio legato al deposito, art. 44 TUIR): quadro RM, rigo RM31, lettera G, 26%;
// - lo stesso valore diventa il costo fiscale delle azioni (acquisto a quel prezzo, senza commissioni);
// - fino alla maturazione le azioni stanno comunque nel conto: si indicano nel quadro RW (scelta prudente).
// Funzioni pure, senza Firebase né rete.

import { executionOn } from './pac.ts'
import type { RawTx } from './engine/types.ts'

export interface BonusGrant {
  /** Chiave stabile: simbolo, data di assegnazione e numero d'ordine nel giorno. */
  id: string
  symbol: string
  isin: string | null
  currency: string
  qty: number
  grantDate: string
  vestDate: string
  /** Prezzo del giorno dell'assegnazione (dal rendiconto): serve solo al quadro RW prima della maturazione. */
  grantPrice: number
}

const DAY = 86400000
const ms = (d: string) => Date.parse(d + 'T12:00:00Z')
const iso = (t: number) => new Date(t).toISOString().slice(0, 10)

export const bonusKeyOf = (g: Pick<BonusGrant, 'id'>) => `premio:${g.id}`

/** Id adatto a una chiave Firebase (niente punti, $, #, [, ], /). */
export function grantId(symbol: string, grantDate: string, n: number): string {
  return `${symbol.replace(/[.$#[\]/\s]/g, '_')}_${grantDate}_${n}`
}

/** Le azioni sono maturate (e quindi reddito) a fine giornata del vesting. */
export const isVested = (g: BonusGrant, date: string) => g.vestDate <= date

export const isRecorded = (g: BonusGrant, txs: RawTx[]) => txs.some(t => t.bonusKey === bonusKeyOf(g))

/** Premi maturati fino a ieri (serve la chiusura di borsa) e non ancora registrati come acquisto. */
export function dueGrants(grants: BonusGrant[], txs: RawTx[], today: string): BonusGrant[] {
  const yesterday = iso(ms(today) - DAY)
  return grants.filter(g => isVested(g, yesterday) && !isRecorded(g, txs))
}

/** Prezzo al vesting: chiusura del giorno di maturazione (o la prima successiva, entro 7 giorni). */
export const vestingPrice = (closes: Record<string, number>, g: BonusGrant, today: string) => executionOn(closes, g.vestDate, today)

const round6 = (n: number) => Math.round(n * 1e6) / 1e6

/** Acquisto che registra le azioni maturate: costo fiscale = valore al vesting, senza commissioni. */
export function buildBonusTx(g: BonusGrant, exec: { date: string; price: number }, newId: () => string): RawTx {
  return {
    id: newId(),
    date: exec.date,
    type: 'buy',
    qty: round6(g.qty),
    price: exec.price,
    commission: 0,
    source: 'premio',
    bonusKey: bonusKeyOf(g),
    priceEstimated: true,
  }
}

/**
 * Movimenti finti per il quadro RW: le azioni premio stanno nel conto dall'assegnazione alla maturazione.
 * Dopo la maturazione c'è l'acquisto vero (registrato da `buildBonusTx`), quindi qui escono il giorno prima.
 */
export function unvestedTxs(grants: BonusGrant[], recorded: RawTx[]): RawTx[] {
  const out: RawTx[] = []
  for (const g of grants) {
    out.push({ date: g.grantDate, type: 'buy', qty: g.qty, price: g.grantPrice })
    const real = recorded.find(t => t.bonusKey === bonusKeyOf(g))
    if (real) out.push({ date: iso(ms(real.date) - DAY), type: 'sell', qty: g.qty, price: Number(real.price) || g.grantPrice })
  }
  return out
}
