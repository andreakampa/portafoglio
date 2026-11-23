// Finestra "Dividendi" di un titolo (come ui/dividendi.js del sito vecchio): dividendi Yahoo con la quantità posseduta
// allo stacco, stato maturato/pagato (pagamento stimato 21 giorni dopo), netto atteso e netto reale.
// Il netto reale arriva dagli accrediti IBKR (movimenti di cassa) oppure si scrive a mano; oltre il 3% di differenza
// dal netto atteso c'è un avviso (di solito manca il credito per la ritenuta USA).
import { qtyBefore, type DividendRow, type YahooDividend } from './engine/dividends.ts'
import type { RawAsset, TaxRegime } from './engine/types.ts'

export const PAY_DELAY_DAYS = 21
export const ANOMALY_SHARE = 0.03
const US_WITHHOLDING = 0.15
const TAX = 0.26

export interface AssetDividendRow {
  exDate: string
  /** Pagamento stimato (stacco + 21 giorni) o data vera dell'accredito IBKR. */
  payDate: string
  payDateEstimated: boolean
  status: 'maturato' | 'pagato'
  perShare: number
  qty: number
  totalNative: number
  /** Lordo in euro al cambio del giorno dello stacco. */
  totalEur: number
  /** Quanto dovrebbe arrivare sul conto: lordo − ritenuta USA − (in amministrato) 26%. */
  expectedNetEur: number
  realNetEur: number | null
  realSource: 'ibkr' | 'manuale' | null
  /** Netto reale lontano più del 3% dal netto atteso. */
  anomaly: boolean
}

export interface AssetDividendsSummary {
  maturedCount: number
  lastExDate: string | null
  paidEur: number
  paidNative: number
  lastPayment: { date: string; eur: number } | null
  anomalies: number
}

const addDays = (iso: string, n: number) => {
  const d = new Date(iso + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const baseSymbol = (s: string) => s.trim().toUpperCase().split('.')[0]!

export function assetDividends(input: {
  asset: RawAsset & { isin?: string }
  assetId: string
  yahoo: YahooDividend[]
  regime: TaxRegime
  fx: (currency: string, date: string) => number | undefined
  today: string
  /** Accrediti veri dei movimenti di cassa (IBKR), di tutto il portafoglio. */
  broker: DividendRow[]
  /** Netti reali scritti a mano, per data di stacco. */
  manual: Record<string, number>
}): { rows: AssetDividendRow[]; summary: AssetDividendsSummary } {
  const { asset, yahoo, regime, fx, today } = input
  const currency = (asset.valuta || 'EUR').toUpperCase()
  const sym = baseSymbol(asset.ticker || asset.nome || input.assetId)
  const mine = input.broker.filter(b => (asset.isin && b.isin === asset.isin) || baseSymbol(b.symbol) === sym)
  const used = new Set<string>()

  const rows: AssetDividendRow[] = []
  for (const d of [...yahoo].sort((a, b) => b.exDate.localeCompare(a.exDate))) {
    if (d.exDate > today) continue
    const qty = qtyBefore(asset.transactions ?? [], d.exDate)
    if (!(qty > 0)) continue
    const rate = currency === 'EUR' ? 1 : fx(currency, d.exDate)
    if (!rate || rate <= 0) continue
    const totalNative = qty * d.amount
    const totalEur = totalNative / rate
    const withholding = currency === 'USD' ? totalEur * US_WITHHOLDING : 0
    const expectedNetEur = totalEur - withholding - (regime === 'dichiarativo' ? 0 : Math.max(0, totalEur - withholding) * TAX)

    // Accredito IBKR dello stesso titolo nei 45 giorni dopo lo stacco.
    const limit = addDays(d.exDate, 45)
    const credit = mine.find(b => !used.has(b.key) && b.date >= d.exDate && b.date <= limit)
    if (credit) used.add(credit.key)
    const manual = input.manual[d.exDate]
    const realNetEur = credit ? credit.grossEur - credit.withholdingEur - (regime === 'dichiarativo' ? 0 : credit.taxEur) : manual ?? null
    const estimatedPay = addDays(d.exDate, PAY_DELAY_DAYS)
    const payDate = credit ? credit.date : estimatedPay
    rows.push({
      exDate: d.exDate,
      payDate,
      payDateEstimated: !credit,
      status: credit || estimatedPay <= today ? 'pagato' : 'maturato',
      perShare: d.amount,
      qty,
      totalNative,
      totalEur,
      expectedNetEur,
      realNetEur,
      realSource: credit ? 'ibkr' : manual != null ? 'manuale' : null,
      anomaly: realNetEur !== null && expectedNetEur > 0 && Math.abs(realNetEur - expectedNetEur) > expectedNetEur * ANOMALY_SHARE,
    })
  }

  const paid = rows.filter(r => r.status === 'pagato')
  const matured = rows.filter(r => r.status === 'maturato')
  const last = paid[0]
  return {
    rows,
    summary: {
      maturedCount: matured.length,
      lastExDate: rows[0]?.exDate ?? null,
      paidEur: paid.reduce((s, r) => s + r.totalEur, 0),
      paidNative: paid.reduce((s, r) => s + r.totalNative, 0),
      lastPayment: last ? { date: last.payDate, eur: last.realNetEur ?? last.expectedNetEur } : null,
      anomalies: rows.filter(r => r.anomaly).length,
    },
  }
}
