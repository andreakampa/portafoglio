import { useEffect, useRef, useState } from 'react'
import { useMaintMarginPct } from '../data/maintMargin'
import {
  DEFAULT_MAINT_PCT,
  marginCallChangePct,
  parseChangePct,
  parseMaintPct,
  stressLevel,
  stressMargin,
  type StressBase,
} from '../domain/engine/marginStress'
import type { MarginSummary } from '../domain/engine/margin'
import { eur } from '../lib/format'
import { Kpi } from './PortfolioPicker'

const MIN = -70
const MAX = 50
// Cali massimi dell'S&P 500 dal picco.
const PRESETS: { label: string; value: number }[] = [
  { label: '−10%', value: -10 },
  { label: '2022 (−25%)', value: -25 },
  { label: 'Covid 2020 (−34%)', value: -34 },
  { label: '2008 (−57%)', value: -57 },
  { label: '+20%', value: 20 },
  { label: 'Oggi', value: 0 },
]

const num = (v: number, d = 1) => v.toFixed(d).replace('.', ',').replace('-', '−')
const signed = (v: number, d = 1) => (v > 0 ? '+' : '') + num(v, d) + '%'
const x = (v: number | null) => (v === null ? 'oltre 100x' : `${num(v, 2)}x`)

/** "Se il portafoglio cambia di…": cursore e campo per vedere l'effetto della leva e a quale calo scatta la margin call. */
export function MarginStress({ m }: { m: MarginSummary }) {
  const [saved, setSaved] = useMaintMarginPct()
  const [change, setChange] = useState(-20)
  const [text, setText] = useState('-20')
  if (m.leverage === null) return null

  const base: StressBase = { grossEur: m.grossEur, positionsEur: m.positionsEur, equityEur: m.equityEur, maintPct: saved ?? DEFAULT_MAINT_PCT }
  const s = stressMargin(base, change)
  const today = stressMargin(base, 0)
  const call = marginCallChangePct(base)
  const level = stressLevel(base, s)
  const go = (v: number) => {
    setChange(v)
    setText(String(v))
  }

  return (
    <section className="stress" aria-labelledby="stress-title">
      <h3 id="stress-title">Se il portafoglio cambia di…</h3>
      <div className="stress-ctrl">
        <input
          type="range"
          min={MIN}
          max={MAX}
          step={1}
          value={Math.max(MIN, Math.min(MAX, Math.round(change)))}
          onChange={e => go(Number(e.target.value))}
          aria-label="Variazione del portafoglio in percentuale"
        />
        <label className="stress-num">
          <input
            type="text"
            inputMode="decimal"
            value={text}
            onChange={e => {
              setText(e.target.value)
              const v = parseChangePct(e.target.value)
              if (v !== null) setChange(v)
            }}
            onBlur={() => setText(String(change))}
            aria-label="Variazione in percentuale"
          />
          %
        </label>
      </div>
      <div className="stress-presets" role="group" aria-label="Scenari">
        {PRESETS.map(p => (
          <button key={p.label} type="button" className={`pill${p.value === change ? ' active' : ''}`} onClick={() => go(p.value)}>
            {p.label}
          </button>
        ))}
      </div>

      <Verdict level={level} call={call} change={change} excessEur={s.excessEur} maintPct={base.maintPct} perTen={-(10 * m.positionsEur) / m.equityEur} />

      <div className="kpis">
        <Kpi label="Valore delle posizioni" value={eur(s.grossEur)} hint={`${signed(change, 0)} · ${eur(s.grossEur - today.grossEur, true)}`} />
        <Kpi
          label="Patrimonio netto"
          value={eur(s.equityEur)}
          className={change < 0 ? 'neg' : change > 0 ? 'pos' : ''}
          hint={change === 0 || s.equityChangePct === null ? 'oggi' : `${signed(s.equityChangePct)} sul tuo capitale`}
        />
        <Kpi label="Leva" value={x(s.leverage)} className={s.leverage === null || s.leverage > (today.leverage ?? 0) + 0.005 ? 'neg' : ''} hint={`oggi ${x(today.leverage)}`} />
        <Kpi
          label="Liquidità in eccesso"
          value={eur(Math.max(0, s.excessEur))}
          className={s.excessEur <= 0 ? 'neg' : ''}
          hint={s.excessEur > 0 ? 'cuscinetto prima della vendita forzata' : `mancano ${eur(-s.excessEur)}: IBKR vende`}
        />
      </div>

      <StressChart base={base} change={change} call={call} />

      <MaintForm key={String(saved)} saved={saved} onSave={setSaved} />
      <p className="muted small">
        Tutti i titoli variano della stessa percentuale e il prestito resta uguale (se il dollaro si rafforza il debito in USD cresce: qui non è
        considerato). IBKR chiede un margine diverso per ogni titolo e può alzarlo nei giorni di panico: tieni un cuscinetto.
      </p>
    </section>
  )
}

function Verdict({ level, call, change, excessEur, maintPct, perTen }: { level: 'ok' | 'near' | 'call'; call: number | null; change: number; excessEur: number; maintPct: number; perTen: number }) {
  const callText = call === null ? null : call < 0 ? `un calo del ${num(-call, 0)}%` : call > 0 ? `un rialzo del ${num(call, 0)}%` : 'il valore di oggi'
  if (level === 'call')
    return (
      <div className="stress-verdict call" role="alert">
        <b>Margin call: IBKR vende titoli senza avvisarti.</b>
        <span>
          {callText && `Succede già con ${callText}. `}Per rientrare servirebbe un versamento di {eur(-excessEur)} oppure vendite per circa {eur(-excessEur / (maintPct / 100))}.
        </span>
      </div>
    )
  if (level === 'near')
    return (
      <div className="stress-verdict near">
        <b>Zona di attenzione.</b>
        <span>
          {callText && `La margin call scatta con ${callText} dal valore di oggi`}
          {call !== null && `: da questo scenario mancano solo ${num(Math.abs(change - call), 0)} punti.`}
        </span>
      </div>
    )
  return (
    <div className="stress-verdict ok">
      <b>{callText ? `Margin call con ${callText} del portafoglio.` : 'Nessuna margin call possibile con questo conto.'}</b>
      <span>
        {call !== null && change !== 0 && Math.sign(change) === Math.sign(call) && `Con questo scenario ti restano ${num(Math.abs(call - change), 0)} punti. `}
        {perTen < 0 && `Con la leva di oggi ogni −10% dei titoli ti costa il ${num(-perTen)}% del tuo capitale.`}
      </span>
    </div>
  )
}

/** Patrimonio netto e mantenimento richiesto al variare dei titoli; la zona rossa è dove IBKR liquida. */
function StressChart({ base, change, call }: { base: StressBase; change: number; call: number | null }) {
  const box = useRef<HTMLDivElement>(null)
  const [W, setW] = useState(700)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, Math.round(e!.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const narrow = W < 520
  const H = narrow ? 220 : 250, pl = 48, pr = 22, pt = 12, pb = 28
  const ends = [MIN, MAX].map(v => stressMargin(base, v))
  const vals = ends.flatMap(e => [e.equityEur, e.maintEur])
  const step = niceStep(Math.max(...vals, 1) / 4)
  const yMax = Math.ceil(Math.max(...vals) / step) * step
  const yMin = Math.min(0, Math.floor(Math.min(...vals) / step) * step)
  const X = (v: number) => pl + ((v - MIN) / (MAX - MIN)) * (W - pl - pr)
  const Y = (v: number) => pt + ((yMax - v) / (yMax - yMin)) * (H - pt - pb)
  const clamped = Math.max(MIN, Math.min(MAX, change))
  const s = stressMargin(base, clamped)
  const ticks: number[] = []
  for (let y = yMin; y <= yMax + 1; y += step) ticks.push(y)
  const callIn = call !== null && call >= MIN && call <= MAX
  const zone = call === null ? null : call <= 0 ? { from: MIN, to: Math.max(MIN, call) } : { from: Math.min(MAX, call), to: MAX }

  return (
    <div className="stress-chart" ref={box}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label="Patrimonio netto e margine di mantenimento al variare del portafoglio">
        {ticks.map(t => (
          <g key={t}>
            <line x1={pl} x2={W - pr} y1={Y(t)} y2={Y(t)} stroke="var(--chart-grid)" />
            <text x={pl - 6} y={Y(t) + 4} textAnchor="end">{`${Math.round(t / 1000)}k €`}</text>
          </g>
        ))}
        {(narrow ? [-60, -30, 0, 30] : [-70, -50, -30, -10, 10, 30, 50]).map(p => (
          <text key={p} x={X(p)} y={H - 10} textAnchor="middle">{`${p > 0 ? '+' : ''}${p}%`}</text>
        ))}
        {zone && zone.to > zone.from && <rect x={X(zone.from)} y={pt} width={X(zone.to) - X(zone.from)} height={H - pt - pb} fill="var(--neg)" opacity={0.1} />}
        <line x1={X(0)} x2={X(0)} y1={pt} y2={H - pb} stroke="var(--chart-axis)" strokeDasharray="3 3" />
        <line x1={X(MIN)} y1={Y(ends[0]!.equityEur)} x2={X(MAX)} y2={Y(ends[1]!.equityEur)} stroke="var(--series-1)" strokeWidth={2.5} />
        <line x1={X(MIN)} y1={Y(ends[0]!.maintEur)} x2={X(MAX)} y2={Y(ends[1]!.maintEur)} stroke="var(--series-2)" strokeWidth={2.5} />
        {callIn && (
          <>
            <circle cx={X(call)} cy={Y(stressMargin(base, call).maintEur)} r={5} fill="var(--neg)" />
            <text x={X(call) + 8} y={Y(stressMargin(base, call).maintEur) + 20} className="stress-call-label">{`margin call ${signed(call, 0)}`}</text>
          </>
        )}
        <line x1={X(clamped)} x2={X(clamped)} y1={pt} y2={H - pb} stroke="var(--text)" strokeWidth={1.5} />
        <circle cx={X(clamped)} cy={Y(s.equityEur)} r={5} fill="var(--series-1)" stroke="var(--surface)" strokeWidth={2} />
        <circle cx={X(clamped)} cy={Y(s.maintEur)} r={5} fill="var(--series-2)" stroke="var(--surface)" strokeWidth={2} />
      </svg>
      <div className="stress-legend small muted">
        <span><i style={{ background: 'var(--series-1)' }} />Patrimonio netto</span>
        <span><i style={{ background: 'var(--series-2)' }} />Margine di mantenimento richiesto</span>
        <span><i className="zone" />Zona di liquidazione</span>
      </div>
    </div>
  )
}

function niceStep(raw: number) {
  const p = 10 ** Math.floor(Math.log10(raw))
  return [1, 2, 2.5, 5, 10].map(k => k * p).find(s => s >= raw) ?? 10 * p
}

/** Mantenimento: stima standard o numero copiato dall'app IBKR (Conto → Margine di mantenimento ÷ valore delle posizioni). */
function MaintForm({ saved, onSave }: { saved: number | null; onSave: (v: number | null) => Promise<void> }) {
  const [text, setText] = useState(saved === null ? '' : String(saved).replace('.', ','))
  const [error, setError] = useState('')
  const save = (v: number | null) => {
    setError('')
    onSave(v).catch(() => setError('Non sono riuscito a salvare il mantenimento.'))
  }
  return (
    <form
      className="inline"
      onSubmit={e => {
        e.preventDefault()
        if (text.trim() && parseMaintPct(text) === null) return setError('Scrivi una percentuale tra 1 e 100, per esempio 27,5.')
        save(parseMaintPct(text))
      }}
    >
      <label className="inline">
        Mantenimento IBKR
        <input type="text" inputMode="decimal" placeholder={String(DEFAULT_MAINT_PCT)} value={text} onChange={e => setText(e.target.value)} style={{ width: '4.5em' }} />
        %
      </label>
      <button type="submit" className="btn btn-ghost">Salva</button>
      {saved !== null && <button type="button" className="linklike" onClick={() => save(null)}>Usa la stima del {DEFAULT_MAINT_PCT}%</button>}
      {saved === null && <span className="muted small">stima standard IBKR per le azioni; puoi mettere il dato esatto (margine di mantenimento ÷ valore delle posizioni)</span>}
      {error && <span className="neg small" role="alert"> {error}</span>}
    </form>
  )
}
