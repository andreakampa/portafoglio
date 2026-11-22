import { useEffect, useMemo, useState } from 'react'
import { dividendsFromCashflows, type CashflowLike } from '../domain/engine/dividends.ts'
import type { FiscalEventInput } from '../domain/engine/fiscal.ts'
import type { MarginPortfolio } from '../domain/engine/margin.ts'
import { computeAllPortfolios, type PortfolioResult, type RawPortfolio } from '../domain/engine/portfolio.ts'
import {
  compareRates, computeQuadroRM, computeQuadroRT, computeQuadroRW, holdingPieces, rmItemsFrom, valueHolding, withoutSavedRates,
  type FxCompareRow, type QuadroRM, type QuadroRT, type QuadroRW, type RwHolding,
} from '../domain/engine/taxReturn.ts'
import type { Issue, RawAsset } from '../domain/engine/types.ts'
import { symbolOf } from '../domain/engine/valuation.ts'
import { loadFx } from '../lib/fxRates.ts'
import { loadMonthlyFx } from '../lib/fxMonthly.ts'
import { loadCloses } from '../lib/priceHistory.ts'
import { THIS_YEAR } from '../lib/format.ts'
import { loadLatestFx, loadQuotes } from '../lib/prices.ts'
import { unvestedTxs, type BonusGrant } from '../domain/bonusShares.ts'
import { useBonusGrants } from './useBonusGrants.ts'
import { useStoredStatement, type StoredStatement } from './taxStatements.ts'
import { usePortfolioState } from './usePortfolioState.ts'

/** Cambi per il prospetto: ufficiali Banca d'Italia del giorno, oppure quelli applicati da IBKR (salvati sui movimenti). */
export type RateMode = 'bdi' | 'ibkr'

/** IBKR per i clienti residenti in Italia: Interactive Brokers Ireland. */
export const BROKER_ISO = 'IE'

export interface TaxReturnData {
  year: number
  /** Anno non ancora chiuso: prezzi e cambi di oggi al posto di quelli al 31/12. */
  provisional: boolean
  rt: QuadroRT
  /** Stesso quadro RT con gli altri cambi, per il confronto. */
  rtOther: QuadroRT
  rm: QuadroRM
  rmOther: QuadroRM
  rw: QuadroRW
  /** Saldo di cassa attuale (non la giacenza media), se il conto è sincronizzato con IBKR. */
  cashNowEur: number | null
  compare: FxCompareRow[]
  issues: (Issue & { assetId: string })[]
  /** Titoli valutati al 31/12 col prezzo di chiusura del rendiconto IBKR importato. */
  closesFromStatement: number
}

export type TaxReturnState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'empty' }
  | {
      status: 'ready'
      options: { id: string; name: string }[]
      selectedId: string
      years: number[]
      year: number
      portfolio: RawPortfolio
      /** Rendiconto IBKR importato per l'anno (undefined = in caricamento). */
      statement: StoredStatement | null | undefined
      /** Azioni premio del broker per questo portafoglio. */
      grants: BonusGrant[]
      data: TaxReturnData | null
    }

const flowsOf = (p: RawPortfolio | undefined): CashflowLike[] => Object.values(((p as { cashflows?: unknown })?.cashflows ?? {}) as Record<string, CashflowLike>)

function eventsOf(p: RawPortfolio, r: PortfolioResult): FiscalEventInput[] {
  const out: FiscalEventInput[] = []
  for (const [assetId, asset] of Object.entries(p.assets ?? {})) {
    for (const e of r.positions[assetId]?.realized ?? []) {
      out.push({ ...e, assetId, assetName: asset.ticker || asset.nome || assetId, assetType: asset.tipoAsset || 'stock' })
    }
  }
  return out
}

/** Ultima chiusura nel giorno indicato o prima (al massimo 10 giorni prima: weekend e festivi). */
function closeOnOrBefore(closes: Record<string, number>, date: string): number | undefined {
  let t = Date.parse(date + 'T12:00:00Z')
  for (let i = 0; i < 10; i++, t -= 86400000) {
    const v = closes[new Date(t).toISOString().slice(0, 10)]
    if (v) return v
  }
  return undefined
}

/** Prospetto per la dichiarazione dei portafogli in regime dichiarativo. */
export function useTaxReturn(pickedId: string | null, year: number | null, mode: RateMode): TaxReturnState {
  const state = usePortfolioState()
  const portfolios = useMemo(
    () => (state.status === 'ready' ? ((state.data?.portfolios as Record<string, RawPortfolio> | undefined) ?? {}) : {}),
    [state],
  )
  const options = Object.entries(portfolios)
    .filter(([, p]) => p.taxRegime === 'dichiarativo')
    .map(([id, p]) => ({ id, name: p.name?.trim() || 'Portafoglio senza nome' }))
  const selectedId = pickedId && options.some(o => o.id === pickedId) ? pickedId : options[0]?.id
  const portfolio = selectedId ? portfolios[selectedId] : undefined

  const thisYear = THIS_YEAR
  const years = useMemo(() => {
    const ys = new Set<number>()
    for (const a of Object.values(portfolio?.assets ?? {})) for (const t of a.transactions ?? []) if (t?.date) ys.add(Number(t.date.slice(0, 4)))
    for (const f of flowsOf(portfolio)) if (f?.date) ys.add(Number(f.date.slice(0, 4)))
    const first = Math.min(...ys, thisYear)
    return Array.from({ length: thisYear - first + 1 }, (_, i) => thisYear - i)
  }, [portfolio, thisYear])
  const y = year && years.includes(year) ? year : years[0]!

  const statement = useStoredStatement(selectedId, y)
  const { grants: allGrants } = useBonusGrants()
  const grants = useMemo(() => (selectedId && allGrants?.[selectedId]) || [], [allGrants, selectedId])
  const grantsKey = grants.map(g => g.id).join(',')
  // Prezzi di chiusura al 31/12 dal rendiconto IBKR: hanno la precedenza su quelli di Yahoo (le istruzioni RW
  // chiedono prima di tutto il valore del rendiconto dell'intermediario).
  const statementCloses = statement && statement.to === `${y}-12-31` ? statement.closes : null
  const closesKey = statementCloses ? JSON.stringify(statementCloses) : ''

  const [data, setData] = useState<{ key: string; value: TaxReturnData } | { key: string; error: string } | null>(null)
  const key = `${selectedId}|${y}|${mode}|${closesKey}|${grantsKey}`

  useEffect(() => {
    if (!portfolio || !selectedId || statement === undefined || allGrants === null) return
    let alive = true
    ;(async () => {
      // 1. Cambi giornalieri della Banca d'Italia per tutti i movimenti in valuta e i movimenti di cassa.
      const dates: string[] = []
      for (const p of Object.values(portfolios)) {
        for (const a of Object.values(p.assets ?? {})) {
          const nonEur = (a.valuta || 'EUR').toUpperCase() !== 'EUR'
          for (const t of a.transactions ?? []) if (nonEur || (t.commissionCurrency && t.commissionCurrency.toUpperCase() !== 'EUR')) dates.push(t.date)
        }
      }
      for (const f of flowsOf(portfolio)) if (f?.date && (f.currency || 'EUR').toUpperCase() !== 'EUR') dates.push(f.date)
      const fx = await loadFx(dates)

      // 2. Motore con i due tipi di cambio.
      const stripped = withoutSavedRates(portfolios)
      const byMode = {
        ibkr: { ps: portfolios, res: computeAllPortfolios(portfolios, fx) },
        bdi: { ps: stripped, res: computeAllPortfolios(stripped, fx) },
      }
      const quadri = (m: RateMode) => {
        const p = byMode[m].ps[selectedId]!
        const r = byMode[m].res[selectedId]!
        const rt = computeQuadroRT(eventsOf(p, r), p.fiscal?.manualLosses ?? [], y)
        const flows = flowsOf(p)
        const rm = computeQuadroRM(rmItemsFrom({
          year: y, assets: (p.assets ?? {}) as Record<string, RawAsset & { isin?: string }>,
          dividends: dividendsFromCashflows(flows, 'dichiarativo', fx), cashflows: flows, etfGains: rt.etfGains, fx, brokerIso: BROKER_ISO,
        }))
        return { rt, rm, issues: r.issues }
      }
      const main = quadri(mode)
      const other = quadri(mode === 'bdi' ? 'ibkr' : 'bdi')

      // 3. Quadro RW: prezzi di chiusura a cavallo d'anno e cambi medi mensili.
      const provisional = y >= thisYear && !statementCloses
      const assets = Object.entries(portfolio.assets ?? {}) as [string, RawAsset & { isin?: string }][]
      // Azioni premio non ancora maturate: stanno nel conto, quindi entrano nel quadro RW (non ancora nei redditi).
      const recordedBonus = assets.flatMap(([, a]) => (a.transactions ?? []).filter(t => t.bonusKey))
      for (const symbol of new Set(grants.map(g => g.symbol))) {
        const list = grants.filter(g => g.symbol === symbol)
        assets.push([`nonmaturate_${symbol}`, {
          ticker: symbol, nome: `${symbol} (premio)`, valuta: list[0]!.currency, ...(list[0]!.isin ? { isin: list[0]!.isin } : {}),
          transactions: unvestedTxs(list, recordedBonus),
        }])
      }
      const needs = assets
        .map(([id, a]) => ({ id, a, symbol: symbolOf(a, id), pieces: holdingPieces(a.transactions ?? [], y, {}) }))
        .filter(x => x.pieces.length)
      const range = thisYear - y >= 1 ? (thisYear - y >= 4 ? '10y' : '5y') : '2y'
      const quotes = provisional ? await loadQuotes(needs.map(n => n.symbol)) : {}
      const latestFx = await loadLatestFx()
      const prices = new Map<string, { startClose?: number; endClose?: number }>()
      let closesFromStatement = 0
      await Promise.all(needs.map(async n => {
        const wantStart = n.pieces.some(p => p.startFromClose)
        const fromStatement = statementCloses?.[n.id]
        const wantEnd = n.pieces.some(p => p.endFromClose) && !fromStatement
        let closes: Record<string, number> = {}
        if (wantStart || (wantEnd && !provisional)) closes = await loadCloses(n.symbol, range).catch(() => ({}))
        if (fromStatement) closesFromStatement++
        prices.set(n.id, {
          startClose: wantStart ? closeOnOrBefore(closes, `${y - 1}-12-31`) : undefined,
          endClose: fromStatement ?? (wantEnd ? (provisional ? quotes[n.symbol]?.price : closeOnOrBefore(closes, `${y}-12-31`)) : undefined),
        })
      }))
      const months = needs.flatMap(n => n.pieces.flatMap(p => [p.start.slice(0, 7), p.end.slice(0, 7)]))
      const monthlyFx = await loadMonthlyFx(months, latestFx)
      const holdings = needs
        .map(n => valueHolding(n.id, n.a, y, prices.get(n.id) ?? {}, monthlyFx))
        .filter((h): h is RwHolding => !!h)

      const ms = (portfolio as MarginPortfolio).marginStatus
      const cashNowEur = provisional && ms?.baseCash != null ? ms.baseCash : null
      const rw = computeQuadroRW(holdings, BROKER_ISO, cashNowEur)

      const value: TaxReturnData = {
        year: y, provisional, rt: main.rt, rtOther: other.rt, rm: main.rm, rmOther: other.rm, rw, cashNowEur,
        compare: compareRates(portfolio.assets ?? {}, y, fx), issues: main.issues, closesFromStatement,
      }
      if (alive) setData({ key, value })
    })().catch(e => alive && setData({ key, error: String(e) }))
    return () => {
      alive = false
    }
  }, [key, portfolio, portfolios, selectedId, y, mode, thisYear, statement, statementCloses, grants, allGrants])

  if (state.status === 'loading') return { status: 'loading' }
  if (state.status === 'error') return { status: 'error', message: state.message }
  if (!selectedId || !portfolio) return { status: 'empty' }
  if (data && data.key === key && 'error' in data) return { status: 'error', message: data.error }
  return { status: 'ready', options, selectedId, years, year: y, portfolio, statement, grants, data: data && data.key === key && 'value' in data ? data.value : null }
}
