// Logo del titolo come nel sito vecchio (logoImg in render.js): tre fonti pubbliche in ordine,
// poi un quadratino con le iniziali se nessuna risponde (o offline).
import { useState } from 'react'

const COLORS = ['#2a7f5e', '#1a6fa0', '#7b4fa0', '#a05c1a', '#1a8a6a', '#6a3fa0', '#a03a3a', '#2a5fa0']
const baseOf = (symbol: string) => symbol.split('.')[0]!.split('-')[0]!.toUpperCase()
// Il simbolo finisce in un indirizzo: si codifica, così caratteri come / ? # non cambiano la richiesta.
const sources = (symbol: string, b = encodeURIComponent(symbol)) => [
  `https://financialmodelingprep.com/image-stock/${b}.png`,
  `https://assets.parqet.com/logos/symbol/${b}?format=jpg`,
  `https://eodhd.com/img/logos/US/${b}.png`,
]

export function TickerLogo({ symbol }: { symbol: string }) {
  const b = baseOf(symbol)
  const [i, setI] = useState(0)
  const list = sources(b)
  if (!b || i >= list.length || b.length > 6) {
    return (
      <span className="ticker-logo ticker-logo-letters" style={{ background: COLORS[(b.charCodeAt(0) || 0) % COLORS.length] }} aria-hidden="true">
        {b.slice(0, 3)}
      </span>
    )
  }
  return <img className="ticker-logo" src={list[i]} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setI(n => n + 1)} />
}
