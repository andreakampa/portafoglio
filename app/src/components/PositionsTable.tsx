// Tabella Posizioni (PC) e schede (telefono), con colonne configurabili, ordinamento e gruppi come nel sito vecchio.
// Se le colonne scelte non ci stanno nella larghezza disponibile si passa alle schede: mai scorrimento laterale nascosto.
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useColumnConfig } from '../data/useColumnConfig'
import type { Computed } from '../data/useComputedPortfolio'
import { useViewPref } from '../data/viewPrefs'
import { useYahooDividends } from '../data/useYahooDividends'
import { qtyBefore } from '../domain/engine/dividends'
import type { PositionRow } from '../domain/engine/valuation'
import {
  COLUMNS, dividendDot, GROUP_LABEL, ROW_ACTION_LABEL, rowActions, GROUPS_OPEN_BY_DEFAULT, groupRows, moveColumn, rowFigures, sortRows, toggleColumn, visibleColumns,
  type ColumnId, type DividendDot, type RowAction, type GroupId, type RowFigures, type SortKey, type SortState,
} from '../domain/positionTable'
import { exportPdf, exportXlsx, type ExportTable } from '../lib/exportTable'
import { eur, money, pct, qty, tone } from '../lib/format'
import { DividendDotView, Range52, Sparkline } from './MiniCharts'
import { Tag, TagButton } from './Tag'
import type { Tone } from './tones'
import { TickerLogo } from './TickerLogo'

type Ready = Extract<Computed, { status: 'ready' }>
type Shown = (x: number | null, signed?: boolean) => string
interface Item { r: PositionRow; f: RowFigures }

const GROUP_ORDER: GroupId[] = ['active', 'short', 'closed', 'transferred', 'empty']
const SORT_KEYS: SortKey[] = ['name', ...COLUMNS.map(c => c.id)]
const SORT_PREFS = SORT_KEYS.flatMap(k => [`${k}:asc`, `${k}:desc`])
const LABEL: Record<ColumnId, string> = Object.fromEntries(COLUMNS.map(c => [c.id, c.label])) as Record<ColumnId, string>
const TODAY = new Date().toISOString().slice(0, 10)
const pctText = (x: number | undefined | null) => (x == null || !Number.isFinite(x) ? '—' : `${x.toFixed(1).replace('.', ',')}%`)

interface Props {
  c: Ready
  shown: Shown
  /** Peso % di ogni titolo sulla base scelta (portafoglio o tutti). */
  weightOf: Record<string, number>
  /** Euro → valuta mostrata (per l'esportazione) e la sua sigla. */
  convert: (eur: number | null) => number | null
  currency: string
  /** Pulsanti sulla riga: Compra, Vendi, Simula, Trasferisci, Elimina… */
  onAction: (action: RowAction, assetId: string) => void
}

const ACTION_TONE: Record<RowAction, Tone> = { buy: 'buy', sell: 'sell', short: 'short', cover: 'cover', sim: 'sim', transfer: 'transfer', delete: 'delete' }

function RowButtons({ group, r, onAction, compact }: { group: GroupId; r: PositionRow; onAction: Props['onAction']; compact?: boolean }) {
  const list = rowActions(group, r.qty)
  if (!list.length) return null
  return (
    <span className={`row-actions ${compact ? 'row-actions-compact' : ''}`}>
      {list.map(a => (
        <TagButton key={a} tone={ACTION_TONE[a]} onClick={() => onAction(a, r.assetId)} title={`${ROW_ACTION_LABEL[a]} ${r.symbol}`}>
          {compact ? <span className="sr-only">{ROW_ACTION_LABEL[a]} {r.symbol}</span> : ROW_ACTION_LABEL[a]}
        </TagButton>
      ))}
    </span>
  )
}

const PER_ASSET_CCY: ColumnId[] = ['pmc', 'price', 'prevClose']
const NO_UNIT: ColumnId[] = ['qty', 'weightCost', 'weightValue', 'pmcEur']
const round = (x: number | null | undefined, d = 2) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d)

export function PositionsTable({ c, shown, weightOf, convert, currency, onAction }: Props) {
  const [cfg, saveCfg] = useColumnConfig()
  const [sortPref, setSortPref] = useViewPref('positionsSort', SORT_PREFS, 'value:desc')
  const [k, d] = sortPref.split(':') as [SortKey, 'asc' | 'desc']
  const sort: SortState = { key: k, dir: d }
  const [showCols, setShowCols] = useState(false)
  const cols = visibleColumns(cfg)
  const colsKey = cols.join(',')

  const assets = c.portfolio.assets ?? {}
  const items = (rows: PositionRow[]): Item[] =>
    rows.map(r => ({ r, f: rowFigures(r, assets[r.assetId], c.result.positions[r.assetId], c.result.fiscal.lines, r.previousClose ?? null) }))
  const groups = groupRows(c.rows, assets)
  // Pallino dei dividendi: stima Yahoo come nel sito vecchio (pagato 21 giorni dopo lo stacco).
  const yDivs = useYahooDividends(c.rows.map(r => r.symbol))
  const dotOf = (r: PositionRow): DividendDot =>
    dividendDot(yDivs[r.symbol] ?? [], ex => qtyBefore(assets[r.assetId]?.transactions ?? [], ex), TODAY)
  const costBase = c.rows.reduce((s, r) => (r.qty > 0 ? s + r.costEur : s), 0)

  const onSort = (key: SortKey) => {
    const dir = sort.key === key ? (sort.dir === 'asc' ? 'desc' : 'asc') : key === 'name' ? 'asc' : 'desc'
    setSortPref(`${key}:${dir}`)
  }

  // Tabella o schede: si misura se la tabella entra nella larghezza disponibile.
  const wrapRef = useRef<HTMLDivElement>(null)
  const [fits, setFits] = useState(true)
  useLayoutEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const check = () => {
      const table = wrap.querySelector('table')
      if (!table || !table.offsetWidth) return
      setFits(table.scrollWidth <= wrap.clientWidth + 1)
    }
    check()
    const ro = new ResizeObserver(check)
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [colsKey, c.rows])

  const cell = (id: ColumnId, { r, f }: Item): ReactNode => {
    const open = r.qty !== 0
    switch (id) {
      case 'qty': return qty(r.qty)
      case 'pmc': return open ? money(r.pmcNative, r.currency) : '—'
      case 'price':
        return (
          <>
            {money(r.price, r.currency)}
            {open && !cols.includes('day') && <small className={`cell-sub ${tone(r.dayChangePct)}`}>{pct(r.dayChangePct)}</small>}
            {open && !cols.includes('day') && <Sparkline points={r.spark} previousClose={r.previousClose} />}
            <Range52 price={r.price} low={r.low52} high={r.high52} currency={r.currency} />
          </>
        )
      case 'prevClose': return money(f.prevClose, r.currency)
      case 'day':
        return open ? <span className={tone(f.dayEur)}>{shown(f.dayEur, true)}<small className="cell-sub">{pct(r.dayChangePct)}</small><Sparkline points={r.spark} previousClose={r.previousClose} /></span> : '—'
      case 'cost': return open ? shown(r.costEur) : '—'
      case 'value': return open ? shown(r.valueEur) : '—'
      case 'weightCost': return open && r.qty > 0 && costBase > 0 ? pctText((r.costEur / costBase) * 100) : '—'
      case 'weightValue': return pctText(weightOf[r.assetId])
      case 'unrealized':
        return open ? (
          <span className={tone(r.unrealizedEur)}>
            {shown(r.unrealizedEur, true)}
            <small className="cell-sub">{pct(r.unrealizedPct)}</small>
            {f.fxEffectEur !== null && Math.abs(f.fxEffectEur) >= 0.01 && <small className="cell-sub muted nowrap" title="Parte del risultato dovuta al cambio">cambio {shown(f.fxEffectEur, true)}</small>}
          </span>
        ) : '—'
      case 'unrealizedNet':
        return open ? <span className={tone(f.unrealizedNetEur)}>{shown(f.unrealizedNetEur, true)}<small className="cell-sub muted">tasse {shown(f.taxEur)}</small></span> : '—'
      case 'realized': return <span className={tone(r.realizedEur)}>{shown(r.realizedEur, true)}</span>
      case 'realizedNet': return <span className={tone(f.realizedNetEur)}>{shown(f.realizedNetEur, true)}</span>
      case 'pmcEur': return open ? eur(f.pmcEur) : '—'
      case 'commissions': return shown(f.commissionsEur)
    }
  }

  const titleCell = ({ r }: Item) => (
    <div className="ticker-cell">
      <TickerLogo symbol={r.symbol} />
      <div>
        <b>{r.symbol}</b>
        {r.currency !== 'EUR' && <span className="ccy">{r.currency}</span>}
        <DividendDotView {...dotOf(r)} />
        {r.isShort && <Tag tone="short">short</Tag>}
        {r.qty !== 0 && <small className="cell-sub muted">{qty(Math.abs(r.qty))} {Math.abs(r.qty) === 1 ? 'azione' : 'azioni'}</small>}
      </div>
    </div>
  )

  const visibleGroups = GROUP_ORDER.filter(g => groups[g].length > 0)

  // Esportazione: titoli attivi e short con le colonne visibili (come il sito vecchio).
  // Excel riceve numeri veri (si possono sommare), il PDF gli stessi già formattati.
  const exportValue = (id: ColumnId, { r, f }: Item): number | null => {
    switch (id) {
      case 'qty': return r.qty
      case 'pmc': return round(r.pmcNative, 4)
      case 'price': return r.price
      case 'prevClose': return f.prevClose
      case 'day': return round(convert(f.dayEur))
      case 'cost': return round(convert(r.costEur))
      case 'value': return round(convert(r.valueEur))
      case 'weightCost': return r.qty > 0 && costBase > 0 ? round((r.costEur / costBase) * 100, 1) : null
      case 'weightValue': return round(weightOf[r.assetId], 1)
      case 'unrealized': return round(convert(r.unrealizedEur))
      case 'unrealizedNet': return round(convert(f.unrealizedNetEur))
      case 'realized': return round(convert(r.realizedEur))
      case 'realizedNet': return round(convert(f.realizedNetEur))
      case 'pmcEur': return round(f.pmcEur, 4)
      case 'commissions': return round(convert(f.commissionsEur))
    }
  }
  const exportText = (id: ColumnId, it: Item): string => {
    const { r, f } = it
    switch (id) {
      case 'qty': return qty(r.qty)
      case 'pmc': return money(r.pmcNative, r.currency)
      case 'price': return money(r.price, r.currency)
      case 'prevClose': return money(f.prevClose, r.currency)
      case 'day': return `${shown(f.dayEur, true)} (${pct(r.dayChangePct)})`
      case 'weightCost':
      case 'weightValue': return pctText(exportValue(id, it))
      case 'unrealized': return `${shown(r.unrealizedEur, true)} (${pct(r.unrealizedPct)})`
      case 'unrealizedNet': return shown(f.unrealizedNetEur, true)
      case 'realized': return shown(r.realizedEur, true)
      case 'realizedNet': return shown(f.realizedNetEur, true)
      case 'pmcEur': return eur(f.pmcEur)
      case 'cost': return shown(r.costEur)
      case 'value': return shown(r.valueEur)
      case 'commissions': return shown(f.commissionsEur)
    }
  }
  const header = (id: ColumnId) => LABEL[id] + (PER_ASSET_CCY.includes(id) ? ' (valuta titolo)' : NO_UNIT.includes(id) ? '' : ` (${currency})`)
  const buildExport = (): ExportTable => {
    const list = sortRows(items([...groups.active, ...groups.short]), sort, costBase)
    const name = c.options.find(o => o.id === c.selectedId)?.name ?? 'Portafoglio'
    const now = new Date()
    return {
      title: `${name}: posizioni`,
      subtitle: `${now.toLocaleString('it-IT')} · importi in ${currency} al cambio di oggi · ${list.length} titoli`,
      headers: ['Titolo', ...cols.map(header)],
      values: list.map(it => [it.r.symbol, ...cols.map(id => exportValue(id, it))]),
      texts: list.map(it => [it.r.symbol, ...cols.map(id => exportText(id, it))]),
      fileName: `posizioni-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${now.toISOString().slice(0, 10)}`,
    }
  }
  const [exporting, setExporting] = useState<string | null>(null)
  const doExport = (kind: 'pdf' | 'xlsx') => {
    setExporting(null)
    const t = buildExport()
    void (kind === 'pdf' ? exportPdf(t) : exportXlsx(t))
      .then(() => setExporting(`File ${kind === 'pdf' ? 'PDF' : 'Excel'} creato: ${t.fileName}`))
      .catch(e => setExporting(`Esportazione non riuscita: ${e instanceof Error ? e.message : String(e)}`))
  }

  return (
    <div className={`pos-view ${fits ? '' : 'use-cards'}`}>
      <div className="pos-tools">
        <label className="inline cards-sort">
          Ordina per
          <select value={sortPref} onChange={e => setSortPref(e.target.value)}>
            <option value="value:desc">Valore</option>
            <option value="unrealized:desc">Risultato €</option>
            <option value="day:desc">Oggi</option>
            <option value="weightValue:desc">Peso</option>
            <option value="name:asc">Nome</option>
          </select>
        </label>
        <span className="export-btns">
          <span className="muted small">Esporta</span>
          <button type="button" className="btn btn-ghost btn-small" onClick={() => doExport('pdf')}>PDF</button>
          <button type="button" className="btn btn-ghost btn-small" onClick={() => doExport('xlsx')}>Excel</button>
        </span>
        <button type="button" className="btn btn-ghost btn-small table-only" aria-expanded={showCols} onClick={() => setShowCols(v => !v)}>
          ⚙ Colonne
        </button>
      </div>

      {exporting && <p className="muted small export-msg" role="status">{exporting}</p>}

      {showCols && (
        <div className="card col-settings">
          <p className="muted small">Scegli le colonne e il loro ordine. Vale su tutti i dispositivi.</p>
          <ul className="col-list">
            {cfg.order.map((id, i) => (
              <li key={id}>
                <label className="check">
                  <input type="checkbox" checked={!cfg.hidden.includes(id)} onChange={() => void saveCfg(toggleColumn(cfg, id))} />
                  {LABEL[id]}
                </label>
                <span className="col-move">
                  <button type="button" className="btn btn-ghost btn-small" disabled={i === 0} aria-label={`Sposta ${LABEL[id]} a sinistra`} onClick={() => void saveCfg(moveColumn(cfg, id, -1))}>↑</button>
                  <button type="button" className="btn btn-ghost btn-small" disabled={i === cfg.order.length - 1} aria-label={`Sposta ${LABEL[id]} a destra`} onClick={() => void saveCfg(moveColumn(cfg, id, 1))}>↓</button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Telefono (o tabella troppo larga): schede. */}
      <div className="pos-cards-wrap">
        {visibleGroups.map(g => (
          <Group key={g} id={g} count={groups[g].length}>
            <ul className="pos-cards">
              {sortRows(items(groups[g]), sort, costBase).map(it => (
                <PositionCard key={it.r.assetId + g} it={it} shown={shown} weight={pctText(weightOf[it.r.assetId])} dot={dotOf(it.r)} actions={<RowButtons group={g} r={it.r} onAction={onAction} />} />
              ))}
            </ul>
          </Group>
        ))}
      </div>

      {/* PC: tabella. */}
      <div className="pos-table-wrap" ref={wrapRef}>
        <table className="pos-table">
          <thead>
            <tr>
              <SortTh label="Titolo" k="name" sort={sort} onSort={onSort} left />
              {cols.map(id => <SortTh key={id} label={LABEL[id]} k={id} sort={sort} onSort={onSort} />)}
              <th className="num">Azioni</th>
            </tr>
          </thead>
          {visibleGroups.map(g => (
            <GroupBody key={g} id={g} count={groups[g].length} span={cols.length + 2}>
              {sortRows(items(groups[g]), sort, costBase).map(it => (
                <tr key={it.r.assetId + g}>
                  <td>{titleCell(it)}</td>
                  {cols.map(id => <td key={id} className="num">{cell(id, it)}</td>)}
                  <td className="num"><RowButtons group={g} r={it.r} onAction={onAction} compact /></td>
                </tr>
              ))}
            </GroupBody>
          ))}
        </table>
      </div>
    </div>
  )
}

function SortTh({ label, k, sort, onSort, left }: { label: string; k: SortKey; sort: SortState; onSort: (k: SortKey) => void; left?: boolean }) {
  const active = sort.key === k
  return (
    <th className={left ? '' : 'num'} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className={`th-sort ${active ? 'active' : ''}`} onClick={() => onSort(k)}>
        {label}
        <span className="sort-arrow" aria-hidden="true">{active ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}</span>
      </button>
    </th>
  )
}

function useGroupOpen(id: GroupId): [boolean, () => void] {
  const [v, set] = useViewPref(`group_${id}`, ['open', 'closed'], GROUPS_OPEN_BY_DEFAULT.includes(id) ? 'open' : 'closed')
  return [v === 'open', () => set(v === 'open' ? 'closed' : 'open')]
}

function GroupBody({ id, count, span, children }: { id: GroupId; count: number; span: number; children: ReactNode }) {
  const [open, toggle] = useGroupOpen(id)
  return (
    <tbody>
      <tr className="group-row">
        <td colSpan={span}>
          <button type="button" className="linklike" aria-expanded={open} onClick={toggle}>
            {open ? '▾' : '▸'} {GROUP_LABEL[id]} <span className="muted">({count})</span>
          </button>
        </td>
      </tr>
      {open && children}
    </tbody>
  )
}

function Group({ id, count, children }: { id: GroupId; count: number; children: ReactNode }) {
  const [open, toggle] = useGroupOpen(id)
  return (
    <section className="pos-group">
      <button type="button" className="linklike group-head" aria-expanded={open} onClick={toggle}>
        {open ? '▾' : '▸'} {GROUP_LABEL[id]} <span className="muted">({count})</span>
      </button>
      {open && children}
    </section>
  )
}

function PositionCard({ it: { r, f }, shown, weight, dot, actions }: { it: Item; shown: Shown; weight: string; dot: DividendDot; actions: ReactNode }) {
  const open = r.qty !== 0
  return (
    <li className="card pos-card">
      <div className="pos-card-head">
        <TickerLogo symbol={r.symbol} />
        <b>{r.symbol}</b>
        {r.currency !== 'EUR' && <span className="ccy">{r.currency}</span>}
        <DividendDotView {...dot} />
        {r.isShort && <Tag tone="short">short</Tag>}
        {open && <span className={`pos-day ${tone(f.dayEur)}`}>{shown(f.dayEur, true)} · {pct(r.dayChangePct)}</span>}
        {open && <Sparkline points={r.spark} previousClose={r.previousClose} />}
      </div>
      {open ? (
        <>
          <div className="pos-card-main">
            <span className="pos-value">{shown(r.valueEur)}</span>
            <span className={tone(r.unrealizedEur)}>{shown(r.unrealizedEur, true)} · {pct(r.unrealizedPct)}</span>
          </div>
          <div className="pos-card-meta muted">
            {qty(r.qty)} × {money(r.price, r.currency)} · PMC {money(r.pmcNative, r.currency)} · <span className="nowrap">peso {weight}</span>
            {f.fxEffectEur !== null && Math.abs(f.fxEffectEur) >= 0.01 && <> · <span className="nowrap">di cui cambio {shown(f.fxEffectEur, true)}</span></>}
          </div>
        </>
      ) : (
        <div className="pos-card-main">
          <span className="muted">Realizzato</span>
          <span className={tone(r.realizedEur)}>{shown(r.realizedEur, true)} · netto {shown(f.realizedNetEur, true)}</span>
        </div>
      )}
      {actions && (
        <details className="card-actions">
          <summary>Azioni</summary>
          {actions}
        </details>
      )}
    </li>
  )
}
