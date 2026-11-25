import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { BENCHMARKS, useHistory } from '../data/useHistory'
import { indexReturn, rebase } from '../domain/engine/history'
import { FX_CRYPTO_TILES, INDEX_TILES, VIX_ALERT, dayChange, formatTilePrice, vixStatus, type MarketTile } from '../domain/market'
import type { RawPortfolio } from '../domain/engine/portfolio'
import { loadQuotes, type Quote } from '../lib/prices'
import { eur, pct } from '../lib/format'
import { LineChart, type LineSeries } from './LineChart'
import { useHistoryChartPrefs } from '../data/useHistoryChartPrefs'
import { TOGGLES, setView, toggleLine, type ToggleKey } from '../domain/historyChart'
import { localToday } from '../lib/today'

const ALL_TILES = [...INDEX_TILES, ...FX_CRYPTO_TILES]
const TODAY = localToday()
const eur0 = (v: number) => `${Math.round(v).toLocaleString('it-IT')} €`

const n2 = (v: number) => v.toLocaleString('it-IT', { maximumFractionDigits: 2, minimumFractionDigits: 2 })

/** Ogni quanto si aggiornano i prezzi del pannello Mercati (solo con la pagina in primo piano). */
const MARKET_REFRESH_MS = 60 * 1000

/** Indici principali, lancetta del VIX, cambio euro/dollaro e crypto (quotazioni Yahoo, aggiornate ogni minuto). */
export function IndicesCard() {
  const [quotes, setQuotes] = useState<Record<string, Quote>>({})
  useEffect(() => {
    let alive = true
    let retry: ReturnType<typeof setTimeout> | undefined
    // All'apertura partono molte richieste (storico dei titoli): se un indice non risponde si riprova dopo 15 secondi.
    const load = (force = false) =>
      loadQuotes(ALL_TILES.map(i => i.symbol), force).then(q => {
        if (!alive) return
        setQuotes(prev => ({ ...prev, ...q }))
        if (Object.keys(q).length < ALL_TILES.length) retry = setTimeout(() => void load(true), 15000)
      })
    void load()
    // Ogni minuto prezzi freschi (ignorando la cache di 5 minuti), ma non con l'app in secondo piano.
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void load(true)
    }, MARKET_REFRESH_MS)
    return () => {
      alive = false
      clearInterval(t)
      clearTimeout(retry)
    }
  }, [])
  const vix = quotes['^VIX']?.price

  return (
    <div className="card">
      <h2>Mercati</h2>
      <div className="market-grid">
        {vix !== undefined && <VixGauge value={vix} />}
        <div className="kpis">
          {INDEX_TILES.map(t => <MarketKpi key={t.symbol} tile={t} quote={quotes[t.symbol]} />)}
        </div>
      </div>
      <div className="kpis kpis-3 market-extra" role="group" aria-label="Cambio euro/dollaro e crypto">
        {FX_CRYPTO_TILES.map(t => <MarketKpi key={t.symbol} tile={t} quote={quotes[t.symbol]} />)}
      </div>
    </div>
  )
}

export function MarketKpi({ tile, quote }: { tile: MarketTile; quote: Quote | undefined }) {
  const ch = quote ? dayChange(quote.price, quote.previousClose) : null
  const valueRef = usePriceFlash(quote?.price)
  return (
    <div className="kpi">
      <span className="kpi-label">{tile.name}</span>
      <span className="kpi-value" ref={valueRef}>{quote ? formatTilePrice(quote.price, tile.decimals) : '—'}</span>
      <span className={`kpi-hint ${ch === null ? '' : ch >= 0 ? 'pos' : 'neg'}`}>{ch === null ? 'in caricamento' : `${pct(ch)} oggi`}</span>
    </div>
  )
}

/**
 * Come su TradingView: quando il prezzo cambia, il numero diventa verde (sale) o rosso (scende)
 * per un istante e poi torna al colore normale con una breve transizione.
 */
function usePriceFlash(price: number | undefined) {
  const ref = useRef<HTMLSpanElement>(null)
  const prev = useRef(price)
  useEffect(() => {
    const before = prev.current
    prev.current = price
    const el = ref.current
    if (!el || before === undefined || price === undefined || price === before) return
    el.classList.remove('flash-up', 'flash-down')
    void el.offsetWidth // fa ripartire l'animazione anche se la direzione è la stessa di prima
    el.classList.add(price > before ? 'flash-up' : 'flash-down')
  }, [price])
  return ref
}

/** Semicerchio da 0 a 50 con tacca sulla soglia (25) e lancetta sul valore attuale. */
function VixGauge({ value }: { value: number }) {
  const max = 50
  const st = vixStatus(value)
  const angle = (v: number) => Math.PI * (1 - Math.min(Math.max(v, 0), max) / max)
  const pt = (v: number, r: number) => [60 + r * Math.cos(angle(v)), 60 - r * Math.sin(angle(v))] as const
  const [nx, ny] = pt(value, 44)
  const [t1x, t1y] = pt(VIX_ALERT, 40)
  const [t2x, t2y] = pt(VIX_ALERT, 56)
  const arc = (from: number, to: number) => {
    const [ax, ay] = pt(from, 50)
    const [bx, by] = pt(to, 50)
    return `M ${ax} ${ay} A 50 50 0 0 1 ${bx} ${by}`
  }
  return (
    <figure className="vix-gauge" aria-label={`VIX ${n2(value)}: ${st.label}. Soglia di attenzione ${VIX_ALERT}.`}>
      <svg viewBox="0 0 120 72" width="160" height="96" role="img">
        <path d={arc(0, max)} className="gauge-track" />
        <path d={arc(0, Math.min(value, max))} className={`gauge-fill status-${st.key}`} />
        <line x1={t1x} y1={t1y} x2={t2x} y2={t2y} className="gauge-tick" />
        <line x1={60} y1={60} x2={nx} y2={ny} className="gauge-needle" />
        <circle cx={60} cy={60} r={3.5} className="gauge-hub" />
      </svg>
      <figcaption>
        <b>VIX {n2(value)}</b> <span className={`status-pill status-${st.key}`}>{st.key === 'critical' ? '▲' : st.key === 'warning' ? '●' : '▼'} {st.label}</span>
        <br />
        <small className="muted">soglia {VIX_ALERT}: {value >= VIX_ALERT ? 'superata' : `mancano ${n2(VIX_ALERT - value)} punti`}</small>
      </figcaption>
    </figure>
  )
}

type Range = '1m' | '3m' | 'ytd' | '1y' | 'all'
const RANGES: { key: Range; label: string }[] = [
  { key: '1m', label: '1 mese' },
  { key: '3m', label: '3 mesi' },
  { key: 'ytd', label: 'Da inizio anno' },
  { key: '1y', label: '1 anno' },
  { key: 'all', label: 'Tutto' },
]

function rangeStart(r: Range, today: string, first: string): string {
  const d = new Date(today + 'T12:00:00Z')
  if (r === 'ytd') return `${today.slice(0, 4)}-01-01` < first ? first : `${today.slice(0, 4)}-01-01`
  if (r === 'all') return first
  if (r === '1m') d.setUTCMonth(d.getUTCMonth() - 1)
  if (r === '3m') d.setUTCMonth(d.getUTCMonth() - 3)
  if (r === '1y') d.setUTCFullYear(d.getUTCFullYear() - 1)
  const s = d.toISOString().slice(0, 10)
  return s < first ? first : s
}

/**
 * Andamento del portafoglio con due viste, come su Interactive Brokers:
 * Valore (euro, con capitale investito) e Performance (% time-weighted, con S&P 500 e Nasdaq 100 a scelta).
 * Vista e linee accese restano salvate su Firebase (`settings/historyChart`).
 */
export function HistoryCard({ portfolio }: { portfolio: RawPortfolio }) {
  const h = useHistory(portfolio)
  const [prefs, savePrefs] = useHistoryChartPrefs()
  const [range, setRange] = useState<Range>('ytd')
  const today = TODAY
  const points = useMemo(() => h.history?.points ?? [], [h.history])
  const from = points.length ? rangeStart(range, today, points[0]!.date) : today
  const view = prefs.view

  const data = useMemo(() => {
    const inRange = points.filter(p => p.date >= from)
    const ret = rebase(points, from)
    const bench = Object.fromEntries(
      BENCHMARKS.map(b => [b.symbol, indexReturn(h.benchmarks[b.symbol] ?? {}, from, today, h.eurUsd).map(p => ({ date: p.date, v: p.pct }))]),
    )
    return {
      value: { key: 'v', name: 'Valore', color: 'var(--series-1)', area: true, points: inRange.map(p => ({ date: p.date, v: p.valueEur })) },
      invested: { key: 'i', name: 'Capitale investito', color: 'var(--muted)', dashed: true, points: inRange.map(p => ({ date: p.date, v: p.investedEur })) },
      perf: { key: 'p', name: 'Portafoglio', color: 'var(--series-1)', points: ret.map(p => ({ date: p.date, v: p.pct })) },
      bench,
    }
  }, [points, from, today, h.benchmarks, h.eurUsd])

  const toggles = TOGGLES.filter(t => t.view === view)
  const colorOf = (key: ToggleKey) => (key === 'gspc' ? 'var(--series-2)' : key === 'ndx' ? 'var(--series-3)' : 'var(--muted)')
  const series: LineSeries[] =
    view === 'value'
      ? [data.value, ...(prefs.show.invested ? [data.invested] : [])]
      : [
          data.perf,
          ...TOGGLES.filter(t => t.view === 'perf' && prefs.show[t.key]).map(t => ({
            key: t.key, name: `${t.label} (in €)`, color: colorOf(t.key), points: data.bench[t.symbol!] ?? [],
          })),
        ]

  const lastValue = data.value.points.at(-1)?.v
  const lastInvested = data.invested.points.at(-1)?.v
  const gain = lastValue !== undefined && lastInvested !== undefined ? lastValue - lastInvested : undefined
  const lastPerf = data.perf.points.at(-1)?.v
  const benchLast = TOGGLES.filter(t => t.symbol).map(t => ({ name: `${t.label} (in €)`, v: data.bench[t.symbol!]?.at(-1)?.v }))

  return (
    <div className="card">
      <div className="chart-head">
        <h2>Andamento</h2>
        <div className="seg" role="group" aria-label="Vista del grafico">
          <button type="button" aria-pressed={view === 'value'} onClick={() => savePrefs(setView(prefs, 'value'))}>Valore</button>
          <button type="button" aria-pressed={view === 'perf'} onClick={() => savePrefs(setView(prefs, 'perf'))}>Performance</button>
        </div>
      </div>
      <div className="pills" role="tablist" aria-label="Periodo">
        {RANGES.map(r => (
          <button key={r.key} type="button" role="tab" aria-selected={range === r.key} className={`pill small-pill ${range === r.key ? 'active' : ''}`} onClick={() => setRange(r.key)}>
            {r.label}
          </button>
        ))}
      </div>
      {!h.history ? (
        <div className="skeleton" style={{ height: 220, marginTop: 12 }} aria-busy="true" />
      ) : (
        <>
          <p className="chart-headline">
            {view === 'value' ? (
              <>
                <b>{eur(lastValue)}</b>
                {gain !== undefined && <span className={`small ${gain >= 0 ? 'pos' : 'neg'}`}>{gain >= 0 ? '+' : ''}{eur(gain)} rispetto al capitale investito</span>}
              </>
            ) : (
              <>
                <b className={lastPerf === undefined ? '' : lastPerf >= 0 ? 'pos' : 'neg'}>{lastPerf === undefined ? '—' : pct(lastPerf)}</b>
                <span className="small muted">rendimento del portafoglio nel periodo</span>
              </>
            )}
          </p>
          <div className="chart-toggles" role="group" aria-label={view === 'value' ? 'Linee da mostrare' : 'Indici da confrontare'}>
            <span className="small muted">{view === 'value' ? 'Mostra anche:' : 'Confronta con:'}</span>
            {toggles.map(t => (
              <button
                key={t.key}
                type="button"
                className="chart-toggle"
                aria-pressed={prefs.show[t.key]}
                style={{ '--toggle-color': colorOf(t.key) } as CSSProperties}
                onClick={() => savePrefs(toggleLine(prefs, t.key))}
              >
                <span className="toggle-dot" aria-hidden="true" />
                {t.label}
              </button>
            ))}
          </div>
          {view === 'value' ? (
            <LineChart series={series} format={v => eur(v)} tickFormat={eur0} label="Valore del portafoglio nel tempo" />
          ) : (
            <LineChart series={series} format={v => pct(v)} tickFormat={v => `${Math.round(v)}%`} zero label="Performance percentuale del portafoglio a confronto con gli indici scelti" />
          )}
          <p className="muted small">
            {view === 'value'
              ? 'Valore: quanto vale il portafoglio ogni giorno (sale anche quando aggiungi soldi). '
              : 'Performance: rendimento "time-weighted", acquisti, vendite e trasferimenti non contano come guadagni. Indici convertiti in euro. '}
            Prezzi e cambi di mercato (Yahoo), non quelli fiscali. Non include dividendi e interessi. Vista e linee scelte restano salvate.
            {h.history.missing.length > 0 && ` Senza quotazioni storiche (valutati al prezzo dei movimenti): ${h.history.missing.join(', ')}.`}
          </p>
          <details>
            <summary className="small">Tabella</summary>
            <table className="pos-table chart-table">
              <thead><tr><th>Serie</th><th className="num">Nel periodo</th></tr></thead>
              <tbody>
                <tr><td>Portafoglio</td><td className="num">{lastPerf === undefined ? '—' : pct(lastPerf)}</td></tr>
                {benchLast.map(l => <tr key={l.name}><td>{l.name}</td><td className="num">{l.v === undefined ? '—' : pct(l.v)}</td></tr>)}
                <tr><td>Valore attuale</td><td className="num">{eur(points.at(-1)?.valueEur)}</td></tr>
                <tr><td>Capitale investito</td><td className="num">{eur(points.at(-1)?.investedEur)}</td></tr>
              </tbody>
            </table>
          </details>
        </>
      )}
    </div>
  )
}
