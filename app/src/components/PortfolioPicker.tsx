import type { PortfolioOption } from '../data/useComputedPortfolio'

export function PortfolioPicker({ options, selectedId, onSelect }: { options: PortfolioOption[]; selectedId: string; onSelect: (id: string) => void }) {
  if (options.length < 2) return null
  return (
    <div className="pills" role="tablist" aria-label="Portafoglio">
      {options.map(o => (
        <button
          key={o.id}
          type="button"
          role="tab"
          aria-selected={o.id === selectedId}
          className={`pill ${o.id === selectedId ? 'active' : ''}`}
          onClick={() => onSelect(o.id)}
        >
          {o.name}
          <span className="pill-sub">{o.regime === 'dichiarativo' ? 'dich.' : 'amm.'}</span>
        </button>
      ))}
    </div>
  )
}

export function Kpi({ label, value, className = '', hint }: { label: string; value: string; className?: string; hint?: string }) {
  return (
    <div className="kpi">
      <span className="kpi-label">{label}</span>
      <span className={`kpi-value ${className}`}>{value}</span>
      {hint && <span className="kpi-hint">{hint}</span>}
    </div>
  )
}
