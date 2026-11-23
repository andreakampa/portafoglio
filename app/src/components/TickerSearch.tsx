// Casella di ricerca del titolo su Yahoo: scrivi nome o ticker, scegli dall'elenco.
import { useEffect, useState } from 'react'
import { parseSearch, searchUrl, type TickerHit } from '../domain/tickerSearch'
import { proxiedJson } from '../lib/proxy'
import { TickerLogo } from './TickerLogo'

export function TickerSearch({ onPick, label = 'Cerca il titolo' }: { onPick: (hit: TickerHit) => void; label?: string }) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<{ q: string; list: TickerHit[]; error?: boolean } | null>(null)

  useEffect(() => {
    const text = q.trim()
    if (text.length < 2) return
    let alive = true
    const timer = setTimeout(() => {
      proxiedJson<unknown>(searchUrl(text), 6000)
        .then(raw => alive && setHits({ q: text, list: parseSearch(raw) }))
        .catch(() => alive && setHits({ q: text, list: [], error: true }))
    }, 300)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [q])

  const shown = q.trim().length >= 2 && hits?.q === q.trim() ? hits : null
  return (
    <div className="ticker-search">
      <label>
        {label}
        <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Nome o ticker, es. Ferrari o NVDA" autoComplete="off" />
      </label>
      {shown && (
        <ul className="ticker-hits" role="listbox" aria-label="Risultati">
          {shown.list.map(h => (
            <li key={h.ticker}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                onClick={() => {
                  onPick(h)
                  setQ('')
                  setHits(null)
                }}
              >
                <TickerLogo symbol={h.ticker} />
                <span className="ticker-hit-main">
                  <b>{h.ticker}</b> <span className="muted">{h.name}</span>
                </span>
                <small className="muted">{[h.typeLabel, h.exchange, h.currency].filter(Boolean).join(' · ')}</small>
              </button>
            </li>
          ))}
          {!shown.list.length && <li className="muted small">{shown.error ? 'Ricerca non riuscita: scrivi il ticker a mano.' : 'Nessun risultato.'}</li>}
        </ul>
      )}
    </div>
  )
}
