// Grafichino della giornata e barra delle 52 settimane, sotto prezzo e variazione (come nel sito vecchio).
import { money } from '../lib/format'

/** Prezzi di oggi ogni 5 minuti; linea tratteggiata = chiusura di ieri. Verde se sopra, rosso se sotto. */
export function Sparkline({ points, previousClose }: { points?: number[]; previousClose?: number | null }) {
  if (!points || points.length < 2) return null
  const W = 64
  const H = 18
  const all = previousClose ? [...points, previousClose] : points
  const min = Math.min(...all)
  const max = Math.max(...all)
  const span = max - min || 1
  const y = (v: number) => H - 1 - ((v - min) / span) * (H - 2)
  const d = points.map((v, i) => `${i ? 'L' : 'M'}${((i / (points.length - 1)) * W).toFixed(1)},${y(v).toFixed(1)}`).join('')
  const up = previousClose ? points[points.length - 1]! >= previousClose : points[points.length - 1]! >= points[0]!
  return (
    <svg className={`spark ${up ? 'spark-up' : 'spark-down'}`} viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label="Andamento di oggi">
      {previousClose ? <line className="spark-base" x1="0" x2={W} y1={y(previousClose)} y2={y(previousClose)} /> : null}
      <path d={d} fill="none" />
    </svg>
  )
}

/** Dove si trova il prezzo tra minimo e massimo delle ultime 52 settimane. */
export function Range52({ price, low, high, currency }: { price: number | null; low?: number | null; high?: number | null; currency: string }) {
  if (price == null || !low || !high || high <= low) return null
  const p = Math.min(1, Math.max(0, (price - low) / (high - low)))
  const zone = p < 1 / 3 ? 'low' : p > 2 / 3 ? 'high' : 'mid'
  return (
    <span className="range52" title={`52 settimane: min ${money(low, currency)} · max ${money(high, currency)} · ${Math.round(p * 100)}% dell'intervallo`}>
      <span className="range52-track">
        <span className={`range52-dot range52-${zone}`} style={{ left: `${p * 100}%` }} />
      </span>
    </span>
  )
}

/** Pallino dei dividendi: verde = pagati, arancione = maturati non ancora pagati. */
export function DividendDotView({ paid, pending }: { paid: boolean; pending: boolean }) {
  if (!paid && !pending) return null
  const title = paid && pending ? 'Dividendi pagati e in maturazione' : paid ? 'Dividendi pagati' : 'Dividendo maturato, non ancora pagato'
  return (
    <span className="div-dot" title={title} aria-label={title} role="img">
      {paid && <span className="div-dot-paid" />}
      {pending && <span className="div-dot-pending" />}
    </span>
  )
}
