import { useEffect, useRef, useState } from 'react'

export interface LineSeries {
  key: string
  name: string
  /** Variabile CSS del colore della serie, es. 'var(--series-1)'. */
  color: string
  points: { date: string; v: number }[]
  /** Linea tratteggiata (es. capitale investito). */
  dashed?: boolean
  /** Area colorata leggera sotto la linea (es. valore del portafoglio). */
  area?: boolean
}

interface Props {
  series: LineSeries[]
  format: (v: number) => string
  /** Formato delle etichette dell'asse (più corto), di base uguale a `format`. */
  tickFormat?: (v: number) => string
  height?: number
  /** Linea dello zero (per i rendimenti in %). */
  zero?: boolean
  label: string
}

const fmtDay = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: '2-digit' })

/** Valore della serie nel giorno indicato o nell'ultimo prima (le serie non hanno tutte gli stessi giorni). */
function valueAt(points: LineSeries['points'], date: string): number | undefined {
  let lo = 0
  let hi = points.length - 1
  let ans: number | undefined
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (points[mid]!.date <= date) {
      ans = points[mid]!.v
      lo = mid + 1
    } else hi = mid - 1
  }
  return ans
}

/** Grafico a linee in SVG: griglia leggera, etichette a fine linea, legenda e lettura con il mirino al passaggio del dito/mouse. */
export function LineChart({ series, format, tickFormat = format, height = 220, zero = false, label }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(600)
  const [hover, setHover] = useState<number | null>(null)

  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(260, Math.round(e!.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const visible = series.filter(s => s.points.length)
  const dates = [...new Set(visible.flatMap(s => s.points.map(p => p.date)))].sort()
  if (!dates.length) return <div ref={box} className="muted small">Nessun dato nel periodo.</div>

  const values = visible.flatMap(s => s.points.map(p => p.v)).concat(zero ? [0] : [])
  let min = Math.min(...values)
  let max = Math.max(...values)
  if (max - min < 1e-9) {
    max += 1
    min -= 1
  }
  const pad = (max - min) * 0.08
  min -= pad
  max += pad

  const labelW = visible.length > 1 ? 92 : 12
  const left = 8
  const right = width - labelW
  const top = 10
  const bottom = height - 24
  const x = (i: number) => left + (dates.length === 1 ? 0 : (i / (dates.length - 1)) * (right - left))
  const y = (v: number) => bottom - ((v - min) / (max - min)) * (bottom - top)
  const idx = new Map(dates.map((d, i) => [d, i]))
  const ticks = Array.from({ length: 4 }, (_, i) => min + ((i + 0.5) / 4) * (max - min))

  const onMove = (clientX: number) => {
    const r = box.current?.getBoundingClientRect()
    if (!r) return
    const px = ((clientX - r.left) / r.width) * width
    const i = Math.round(((px - left) / (right - left)) * (dates.length - 1))
    setHover(Math.max(0, Math.min(dates.length - 1, i)))
  }

  // Etichette a fine linea: si scostano solo quanto basta per non sovrapporsi.
  const ends = visible
    .map(s => ({ s, v: s.points.at(-1)!.v }))
    .sort((a, b) => y(a.v) - y(b.v))
    .map(e => ({ ...e, ly: y(e.v) }))
  for (let i = 1; i < ends.length; i++) if (ends[i]!.ly - ends[i - 1]!.ly < 14) ends[i]!.ly = ends[i - 1]!.ly + 14

  const hd = hover !== null ? dates[hover]! : null

  return (
    <div className="chart" ref={box}>
      {visible.length > 1 && (
        <ul className="chart-legend" aria-label="Legenda">
          {visible.map(s => (
            <li key={s.key}><span className={`key-line${s.dashed ? ' dashed' : ''}`} style={{ color: s.color, background: s.dashed ? undefined : s.color }} />{s.name}</li>
          ))}
        </ul>
      )}
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={label}
        onPointerMove={e => onMove(e.clientX)}
        onPointerDown={e => onMove(e.clientX)}
        onPointerLeave={() => setHover(null)}
      >
        {ticks.map(t => (
          <g key={t}>
            <line x1={left} x2={right} y1={y(t)} y2={y(t)} className="chart-grid" />
            <text x={left + 2} y={y(t) - 3} className="chart-tick">{tickFormat(t)}</text>
          </g>
        ))}
        {zero && min < 0 && max > 0 && <line x1={left} x2={right} y1={y(0)} y2={y(0)} className="chart-axis" />}
        {visible.filter(s => s.area).map(s => (
          <polygon
            key={s.key + '-area'}
            fill={s.color}
            fillOpacity={0.1}
            points={s.points.map(p => `${x(idx.get(p.date)!)},${y(p.v)}`).join(' ') + ` ${x(idx.get(s.points.at(-1)!.date)!)},${bottom} ${x(idx.get(s.points[0]!.date)!)},${bottom}`}
          />
        ))}
        {visible.map(s => (
          <polyline
            key={s.key}
            fill="none"
            stroke={s.color}
            strokeWidth={2}
            strokeDasharray={s.dashed ? '5 4' : undefined}
            strokeLinejoin="round"
            strokeLinecap="round"
            points={s.points.map(p => `${x(idx.get(p.date)!)},${y(p.v)}`).join(' ')}
          />
        ))}
        {visible.length > 1 && ends.map(e => (
          <text key={e.s.key} x={right + 6} y={e.ly + 4} className="chart-end">{format(e.v)}</text>
        ))}
        {[0, Math.floor((dates.length - 1) / 2), dates.length - 1].filter((v, i, a) => a.indexOf(v) === i).map((i, k, arr) => (
          <text key={i} x={x(i)} y={height - 6} className="chart-tick" textAnchor={k === 0 ? 'start' : k === arr.length - 1 ? 'end' : 'middle'}>{fmtDay(dates[i]!)}</text>
        ))}
        {hd && (
          <g>
            <line x1={x(hover!)} x2={x(hover!)} y1={top} y2={bottom} className="chart-cross" />
            {visible.map(s => {
              const v = valueAt(s.points, hd)
              return v === undefined ? null : <circle key={s.key} cx={x(hover!)} cy={y(v)} r={4} fill={s.color} className="chart-dot" />
            })}
          </g>
        )}
      </svg>
      {hd && (
        <div className="chart-tip" style={{ left: Math.min(Math.max(x(hover!) / width, 0.15), 0.85) * 100 + '%' }} role="status">
          <div className="muted small">{fmtDay(hd)}</div>
          {visible.map(s => {
            const v = valueAt(s.points, hd)
            return v === undefined ? null : (
              <div key={s.key} className="chart-tip-row"><span className="key-line" style={{ background: s.color }} /><b>{format(v)}</b> <span className="muted">{s.name}</span></div>
            )
          })}
        </div>
      )}
    </div>
  )
}
