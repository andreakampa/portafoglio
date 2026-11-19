import type { PortfolioResult, RawPortfolio } from '../domain/engine/portfolio'
import { symbolOf } from '../domain/engine/valuation'

/** Problemi nei dati che rendono un numero non affidabile: sempre visibili, mai nascosti. */
export function Issues({ result, portfolio }: { result: PortfolioResult; portfolio: RawPortfolio }) {
  if (!result.issues.length) return null
  return (
    <details className="card warn">
      <summary>
        {result.issues.length === 1 ? '1 movimento da controllare' : `${result.issues.length} movimenti da controllare`}
      </summary>
      <ul>
        {result.issues.map((i, n) => {
          const a = portfolio.assets?.[i.assetId]
          return (
            <li key={n}>
              <b>{a ? symbolOf(a, i.assetId) : i.assetId}</b> — {i.message}
            </li>
          )
        })}
      </ul>
    </details>
  )
}
