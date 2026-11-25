// Panoramica: riquadro "Operazioni recenti" (acquisti e short degli ultimi giorni) che apre la finestra con il dettaglio.
import { useMemo, useState } from 'react'
import type { Computed } from '../data/useComputedPortfolio'
import { useViewPref } from '../data/viewPrefs'
import { inWindow, RECENT_WINDOWS, recentTotals, recentTrades, windowStart, type RecentTrade, type RecentWindow } from '../domain/recentTrades'
import { eur, money, pct, qty, tone } from '../lib/format'
import { localToday } from '../lib/today'
import { Modal } from './Modal'
import { Tag } from './Tag'

type Ready = Extract<Computed, { status: 'ready' }>

const RANGE_LABEL: Record<RecentWindow, string> = { '1': 'oggi e ieri', '3': 'ultimi 3 giorni', '7': 'ultimi 7 giorni' }

function dayLabel(date: string, today: string): string {
  if (date === today) return 'oggi'
  if (date === windowStart(today, 1)) return 'ieri'
  const d = new Date(date + 'T12:00:00Z')
  const wd = d.toLocaleDateString('it-IT', { weekday: 'short', timeZone: 'UTC' }).replace('.', '')
  return `${wd} ${date.slice(8, 10)}/${date.slice(5, 7)}`
}

export function RecentTradesCard({ c }: { c: Ready }) {
  const [win, setWin] = useViewPref<RecentWindow>('recentTrades', RECENT_WINDOWS, '3')
  const [open, setOpen] = useState(false)
  const today = localToday()
  const all = useMemo(() => {
    const quotes = Object.fromEntries(c.rows.filter(r => r.price != null).map(r => [r.symbol, { price: r.price!, currency: r.currency }]))
    return recentTrades(c.portfolio, c.fx, quotes, c.latestFx, today)
  }, [c.portfolio, c.fx, c.rows, c.latestFx, today])
  if (!all.length) return null
  const list = inWindow(all, today, Number(win))
  const tot = recentTotals(list)

  return (
    <>
      <button type="button" className="card recent-card" onClick={() => setOpen(true)} aria-haspopup="dialog">
        <span className="row-head">
          <span className="recent-title">Operazioni recenti</span>
          <span className="recent-open">Apri ›</span>
        </span>
        {list.length ? (
          <>
            <span className="recent-total">
              <b className={tone(tot.unrealizedEur)}>{eur(tot.unrealizedEur, true)}</b> <span className={tone(tot.unrealizedEur)}>{pct(tot.unrealizedPct)}</span>
            </span>
            <span className="muted small">
              {RANGE_LABEL[win]} · {list.length === 1 ? '1 operazione' : `${list.length} operazioni`} · P&amp;L non realizzato
            </span>
            <ul className="top-list">
              {list.slice(0, 3).map(t => (
                <li key={t.key}>
                  <span><b>{t.symbol}</b><KindTag t={t} /> <small className="muted">{dayLabel(t.date, today)}</small></span>
                  <ResultSmall t={t} />
                </li>
              ))}
            </ul>
            {list.length > 3 && <span className="muted small">+ {list.length - 3 === 1 ? 'un\'altra' : `altre ${list.length - 3}`}</span>}
          </>
        ) : (
          <span className="muted small">Nessun acquisto o short negli {RANGE_LABEL[win]}: apri per vedere gli ultimi 7 giorni.</span>
        )}
      </button>
      {open && <RecentTradesModal all={all} win={win} setWin={setWin} today={today} name={c.options.find(o => o.id === c.selectedId)?.name ?? ''} onClose={() => setOpen(false)} />}
    </>
  )
}

function KindTag({ t }: { t: RecentTrade }) {
  return t.kind === 'short_sell' ? <Tag tone="short">short</Tag> : <Tag tone="buy">acquisto</Tag>
}

function ResultSmall({ t }: { t: RecentTrade }) {
  if (t.openQty <= 1e-9) return <small className="num muted">{t.kind === 'buy' ? 'venduta' : 'ricoperta'} il {dayMonth(t.closedOn)} · {eur(t.realizedEur, true)}</small>
  return <small className={`num ${tone(t.unrealizedEur)}`}>{eur(t.unrealizedEur, true)} · {pct(t.unrealizedPct)}</small>
}

function RecentTradesModal({ all, win, setWin, today, name, onClose }: {
  all: RecentTrade[]; win: RecentWindow; setWin: (w: RecentWindow) => void; today: string; name: string; onClose: () => void
}) {
  const list = inWindow(all, today, Number(win))
  const tot = recentTotals(list)
  return (
    <Modal title={`Operazioni recenti${name ? ` · ${name}` : ''}`} onClose={onClose} wide>
      <div className="recent-head">
        <div className="seg" role="group" aria-label="Periodo">
          {RECENT_WINDOWS.map(w => (
            <button key={w} type="button" aria-pressed={w === win} onClick={() => setWin(w)}>{w}D</button>
          ))}
        </div>
        <div className="recent-head-total">
          <span className="muted small">P&amp;L non realizzato · {RANGE_LABEL[win]}</span>
          <span className="recent-total">
            <b className={tone(tot.unrealizedEur)}>{eur(tot.unrealizedEur, true)}</b> <span className={tone(tot.unrealizedEur)}>{pct(tot.unrealizedPct)}</span>
          </span>
          {tot.missingPrices > 0 && <span className="muted small">{tot.missingPrices} senza prezzo, escluse</span>}
        </div>
      </div>

      {!list.length && <p className="muted">Nessun acquisto o short negli {RANGE_LABEL[win]}.</p>}

      {list.length > 0 && (
        <>
          <ul className="pos-cards">
            {list.map(t => (
              <li key={t.key} className="card pos-card">
                <div className="pos-card-head">
                  <b>{t.symbol}</b><KindTag t={t} />
                  <span className={`pos-day ${t.openQty > 1e-9 ? tone(t.unrealizedEur) : ''}`}>{t.openQty > 1e-9 ? eur(t.unrealizedEur, true) : ''}</span>
                </div>
                <div className="pos-card-main muted small">
                  <span>{dayLabel(t.date, today)} · {qty(t.qty)} × {money(t.price, t.currency)}</span>
                  <span className={tone(t.unrealizedEur)}>{t.openQty > 1e-9 ? pct(t.unrealizedPct) : ''}</span>
                </div>
                <div className="pos-card-main small">
                  <span><span className="muted">{t.kind === 'buy' ? 'pagati' : 'incassati'}</span> {eur(t.costEur)}</span>
                  {t.openQty > 1e-9 && <span><span className="muted">ora</span> {eur(t.valueEur)}</span>}
                </div>
                <Closed t={t} />
              </li>
            ))}
          </ul>
          <table className="pos-table">
            <thead>
              <tr>
                <th>Data</th><th>Titolo</th><th className="num">Q.tà × prezzo</th><th className="num">Costo</th><th className="num">Valore ora</th><th className="num">Variazione</th>
              </tr>
            </thead>
            <tbody>
              {list.map(t => (
                <tr key={t.key}>
                  <td className="muted">{dayLabel(t.date, today)}</td>
                  <td><b>{t.symbol}</b><KindTag t={t} /><Closed t={t} /></td>
                  <td className="num">{qty(t.qty)} × {money(t.price, t.currency)}</td>
                  <td className="num">{eur(t.costEur)}<br /><small className="muted">{t.kind === 'buy' ? 'pagati' : 'incassati'}</small></td>
                  <td className="num">
                    {t.openQty > 1e-9 ? eur(t.valueEur) : '—'}
                    {t.priceNow != null && t.openQty > 1e-9 && <><br /><small className="muted">ora {money(t.priceNow, t.currency)}</small></>}
                  </td>
                  <td className={`num ${t.openQty > 1e-9 ? tone(t.unrealizedEur) : ''}`}>
                    {t.openQty > 1e-9 ? <><b>{eur(t.unrealizedEur, true)}</b><br /><small>{pct(t.unrealizedPct)}</small></> : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <p className="muted small">
        Costo = quantità × prezzo e commissioni, in euro al cambio del giorno dell'operazione. Valore ora = prezzo e cambio di adesso.
        Per gli short la variazione è positiva quando il prezzo scende. Se nel frattempo hai venduto, la riga lo dice e quel pezzo non entra nel non realizzato
        (si chiude per primo l'acquisto più recente). Solo acquisti e aperture di short, al massimo 7 giorni.
      </p>
    </Modal>
  )
}

function Closed({ t }: { t: RecentTrade }) {
  if (t.closedQty <= 1e-9) return null
  const buy = t.kind === 'buy'
  const what = t.openQty <= 1e-9 ? (buy ? 'venduta' : 'ricoperta') : `${qty(t.closedQty)} ${buy ? 'vendute' : 'ricoperte'}`
  return (
    <div className="small">
      <span className="muted">{what} il {dayMonth(t.closedOn)} · risultato </span>
      <b className={tone(t.realizedEur)}>{eur(t.realizedEur, true)}</b>
    </div>
  )
}

const dayMonth = (d: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : '')
