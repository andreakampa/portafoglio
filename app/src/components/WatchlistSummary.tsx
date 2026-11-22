import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { useWatchlist } from '../data/useWatchlist'
import { loadQuotes, type Quote } from '../lib/prices'

/** In Panoramica: titoli della watchlist arrivati a una soglia, e collegamento alla pagina. */
export function WatchlistSummary() {
  const { items } = useWatchlist()
  const [quotes, setQuotes] = useState<Record<string, Quote>>({})
  const symbols = (items ?? []).filter(i => i.above != null || i.below != null).map(i => i.symbol).join(',')
  useEffect(() => {
    if (!symbols) return
    let alive = true
    void loadQuotes(symbols.split(',')).then(q => alive && setQuotes(q))
    return () => {
      alive = false
    }
  }, [symbols])
  if (!items) return null
  const hits = items.filter(i => {
    const p = quotes[i.symbol]?.price
    return p && ((i.above != null && p >= i.above) || (i.below != null && p <= i.below))
  })
  return (
    <div className="card">
      <div className="row-head">
        <h2>Watchlist</h2>
        <Link to="/watchlist">Apri ({items.length})</Link>
      </div>
      {hits.length ? (
        <p className="small"><span className="status-pill status-critical">▲ soglia raggiunta</span> {hits.map(h => h.symbol).join(', ')}</p>
      ) : (
        <p className="muted small">{items.length ? 'Nessuna soglia raggiunta.' : 'Aggiungi titoli da seguire e soglie di prezzo, o importali da IBKR.'}</p>
      )}
    </div>
  )
}
