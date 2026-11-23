import { useEffect, useMemo, useState } from 'react'
import { BENCHMARKS, useHistory } from '../data/useHistory'
import { indexReturn, rebase } from '../domain/engine/history'
import { VIX_ALERT, vixStatus } from '../domain/market'
import type { RawPortfolio } from '../domain/engine/portfolio'
import { loadQuotes, type Quote } from '../lib/prices'
import { eur, pct } from '../lib/format'
import { LineChart } from './LineChart'
import { localToday } from '../lib/today'

const INDICES = [
  { symbol: '^NDX', name: 'Nasdaq 100' },
  { symbol: '^GSPC', name: 'S&P 500' },
  { symbol: '^VIX', name: 'VIX' },
  { symbol: '^VXN', name: 'VXN' },
]
const TODAY = localToday()
const eur0 = (v: number) => `${Math.round(v).toLocaleString('it-IT')} €`

const n2 = (v: number) => v.toLocaleString('it-IT', { maximumFractionDigits: 2, minimumFractionDigits: 2 })

/** Indici principali e lancetta del VIX (quotazioni Yahoo, aggiornate ogni 5 minuti). */
export function IndicesCard() {
  const [quotes, setQuotes] = useState<Record<string, Quote>>({})
  useEffect(() => {
    let alive = true
    let retry: ReturnType<typeof setTimeout> | undefined
    // All'apertura partono molte richieste (storico dei titoli): se un indice non risponde si riprova dopo 15 secondi.
    const load = () =>
      loadQuotes(INDICES.map(i => i.symbol)).then(q => {
        if (!alive) return
        setQuotes(prev => ({ ...prev, ...q }))
        if (Object.keys(q).length < INDICES.length) retry = setTimeout(load, 15000)
      })
    void load()
    const t = setInterval(load, 5 * 60 * 1000)
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
          {INDICES.map(i => {
            const q = quotes[i.symbol]
            const ch = q?.previousClose ? ((q.price - q.previousClose) / q.previousClose) * 100 : null
            return (
              <div key={i.symbol} className="kpi">
                <span className="kpi-label">{i.name}</span>
                <span className="kpi-value">{q ? n2(q.price) : '—'}</span>
                <span className={`kpi-hint ${ch === null ? '' : ch >= 0 ? 'pos' : 'neg'}`}>{ch === null ? 'in caricamento' : `${pct(ch)} oggi`}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
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

/** Valore del portafoglio nel tempo e rendimento confrontato con S&P 500 e Nasdaq 100 (in euro). */
export function HistoryCard({ portfolio }: { portfolio: RawPortfolio }) {
  const h = useHistory(portfolio)
  const [range, setRange] = useState<Range>('ytd')
  const today = TODAY
  const points = useMemo(() => h.history?.points ?? [], [h.history])
  const from = points.length ? rangeStart(range, today, points[0]!.date) : today

  const data = useMemo(() => {
    const inRange = points.filter(p => p.date >= from)
    const ret = rebase(points, from)
    return {
      value: [
        { key: 'v', name: 'Valore', color: 'var(--series-1)', points: inRange.map(p => ({ date: p.date, v: p.valueEur })) },
        { key: 'i', name: 'Capitale investito', color: 'var(--series-2)', points: inRange.map(p => ({ date: p.date, v: p.investedEur })) },
      ],
      ret: [
        { key: 'p', name: 'Portafoglio', color: 'var(--series-1)', points: ret.map(p => ({ date: p.date, v: p.pct })) },
        ...BENCHMARKS.map((b, i) => ({
          key: b.symbol, name: `${b.name} (in €)`, color: `var(--series-${i + 2})`,
          points: indexReturn(h.benchmarks[b.symbol] ?? {}, from, today, h.eurUsd).map(p => ({ date: p.date, v: p.pct })),
        })),
      ],
    }
  }, [points, from, today, h.benchmarks, h.eurUsd])

  const last = data.ret.map(s => ({ name: s.name, v: s.points.at(-1)?.v }))

  return (
    <div className="card">
      <h2>Andamento</h2>
      <div className="pills" role="tablist" aria-label="Periodo">
        {RANGES.map(r => (
          <button key={r.key} type="button" role="tab" aria-selected={range === r.key} className={`pill small-pill ${range === r.key ? 'active' : ''}`} onClick={() => setRange(r.key)}>
            {r.label}
          </button>
        ))}
      </div>
      {!h.history ? (
        <div className="skeleton" style={{ height: 220 }} aria-busy="true" />
      ) : (
        <>
          <h3>Valore e capitale investito</h3>
          <LineChart series={data.value} format={v => eur(v)} tickFormat={eur0} label="Valore del portafoglio e capitale investito nel tempo" />
          <h3>Rendimento a confronto</h3>
          <LineChart series={data.ret} format={v => pct(v)} tickFormat={v => `${Math.round(v)}%`} zero label="Rendimento del portafoglio, dell'S&P 500 e del Nasdaq 100 nel periodo" />
          <p className="muted small">
            Rendimento "time-weighted": acquisti, vendite e trasferimenti non contano come guadagni. Indici convertiti in euro.
            Prezzi e cambi di mercato (Yahoo), non quelli fiscali. Non include dividendi e interessi.
            {h.history.missing.length > 0 && ` Senza quotazioni storiche (valutati al prezzo dei movimenti): ${h.history.missing.join(', ')}.`}
          </p>
          <details>
            <summary className="small">Tabella</summary>
            <table className="pos-table chart-table">
              <thead><tr><th>Serie</th><th className="num">Rendimento nel periodo</th></tr></thead>
              <tbody>
                {last.map(l => <tr key={l.name}><td>{l.name}</td><td className="num">{l.v === undefined ? '—' : pct(l.v)}</td></tr>)}
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
