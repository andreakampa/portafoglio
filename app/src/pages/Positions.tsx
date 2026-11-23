import { useState } from 'react'
import { AssetDividends } from '../components/AssetDividends'
import { AssetHistory } from '../components/AssetHistory'
import { Issues } from '../components/Issues'
import { Modal } from '../components/Modal'
import { MovementForm, TransferFormCard } from '../components/MovementForms'
import { MarginCard } from '../components/MarginCard'
import { PositionsKpiGroups } from '../components/PositionsKpiGroups'
import { PositionsTable } from '../components/PositionsTable'
import { PriceBar } from '../components/PriceBar'
import { PortfolioPicker } from '../components/PortfolioPicker'
import { useAllPortfoliosValue } from '../data/useAllPortfoliosValue'
import { useComputedPortfolio } from '../data/useComputedPortfolio'
import { usePortfolioEdit } from '../data/usePortfolioEdit'
import { useViewPref } from '../data/viewPrefs'
import { grossValueEur, toDisplay, weights, type DisplayCurrency, type WeightBase } from '../domain/display'
import { availableLosses } from '../domain/engine/fiscal'
import { ROW_ACTION_LABEL, type RowAction } from '../domain/positionTable'
import { deleteAssetBlock, type EditableType } from '../domain/txEdit'
import { cash, qty as fmtQty, THIS_YEAR } from '../lib/format'
import { Simulator } from './Simulator'

const TX_TYPE: Partial<Record<RowAction, EditableType>> = { buy: 'buy', sell: 'sell', short: 'short_sell', cover: 'buy_to_cover' }

export function Positions() {
  const c = useComputedPortfolio()
  const [currency, setCurrency] = useViewPref<DisplayCurrency>('currency', ['EUR', 'USD'], 'EUR')
  const [weightBase, setWeightBase] = useViewPref<WeightBase>('weightBase', ['portfolio', 'all'], 'portfolio')
  const ready = c.status === 'ready'
  const edit = usePortfolioEdit()
  const [open, setOpen] = useState<{ action: RowAction; assetId: string } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const allValue = useAllPortfoliosValue(ready && weightBase === 'all', ready ? c.portfolios : NONE, ready ? c.allResults : NONE, ready ? c.latestFx : NONE)

  if (c.status === 'loading') return <section className="page"><h1>Posizioni</h1><div className="card skeleton" style={{ height: 240 }} /></section>
  if (c.status === 'error') return <section className="page"><h1>Posizioni</h1><div className="card error">{c.message}</div></section>
  if (c.status === 'empty') return <section className="page"><h1>Posizioni</h1><div className="card">Nessun portafoglio.</div></section>

  const openRows = c.rows.filter(r => r.qty !== 0)
  // Importi della tabella nella valuta scelta (cambio di mercato di oggi); i riquadri restano in euro.
  const usdRate = c.eurUsd?.rate ?? c.latestFx.USD ?? null
  const shown = (x: number | null, signed = false) => cash(toDisplay(x, currency, usdRate), currency, signed)
  const weightOf = weights(openRows, weightBase === 'all' ? allValue ?? 0 : grossValueEur(openRows))
  const symbolOfId = (id: string) => c.rows.find(r => r.assetId === id)?.symbol ?? id

  // Pulsanti sulla riga: le finestre si aprono sopra la pagina, Elimina chiede conferma.
  async function onAction(action: RowAction, assetId: string) {
    if (c.status !== 'ready') return
    setNotice(null)
    if (action !== 'delete') return setOpen({ action, assetId })
    const asset = c.portfolio.assets?.[assetId]
    const block = deleteAssetBlock(asset)
    if (block) return setNotice(block)
    const n = asset?.transactions?.length ?? 0
    const held = c.result.positions[assetId]?.qty ?? 0
    const what = `${symbolOfId(assetId)}${held ? ` (${fmtQty(held)} in portafoglio)` : ''}`
    if (!confirm(`Eliminare ${what} con tutti i suoi ${n} movimenti? Non si può annullare.${n ? ' Se arrivano da IBKR, la sincronizzazione non li reimporta.' : ''}`)) return
    try {
      await edit.removeAsset(c.selectedId, assetId, n)
      setNotice(`${symbolOfId(assetId)} eliminato.`)
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Eliminazione non riuscita: controlla la connessione e riprova.')
    }
  }
  const close = () => setOpen(null)
  const txType = open ? TX_TYPE[open.action] : undefined

  return (
    <section className="page">
      <header className="page-head">
        <h1>Posizioni</h1>
        <PortfolioPicker options={c.options} selectedId={c.selectedId} onSelect={c.select} />
      </header>

      <PositionsKpiGroups c={c} />
      {c.totals.missingPrices > 0 && <p className="muted small">{c.totals.missingPrices} titoli senza prezzo aggiornato: esclusi dai totali.</p>}

      <MarginCard c={c} />

      <Issues result={c.result} portfolio={c.portfolio} />

      <PriceBar
        eurUsd={c.eurUsd}
        currency={currency}
        onCurrency={setCurrency}
        weightBase={weightBase}
        onWeightBase={setWeightBase}
        lossesEur={availableLosses(c.result.fiscal, THIS_YEAR)}
        pricesAt={c.pricesAt}
        loading={c.pricesLoading}
        onRefresh={c.refreshPrices}
      />

      {notice && <p className="card small" role="status">{notice}</p>}

      <PositionsTable c={c} shown={shown} weightOf={weightOf} convert={x => toDisplay(x, currency, usdRate)} currency={currency} onAction={(a, id) => void onAction(a, id)} />

      {open && txType && (
        <Modal title={`${ROW_ACTION_LABEL[open.action]} ${symbolOfId(open.assetId)}`} onClose={close}>
          <MovementForm c={c} preset={{ assetId: open.assetId, type: txType }} onClose={close} bare />
        </Modal>
      )}
      {open?.action === 'transfer' && (
        <Modal title={`Trasferisci ${symbolOfId(open.assetId)}`} onClose={close}>
          <TransferFormCard c={c} presetAssetId={open.assetId} onClose={close} bare />
        </Modal>
      )}
      {open?.action === 'history' && (
        <Modal title={`Storico ${symbolOfId(open.assetId)}`} onClose={close} wide>
          <AssetHistory c={c} assetId={open.assetId} />
        </Modal>
      )}
      {open?.action === 'dividends' && (
        <Modal title={`Dividendi ${symbolOfId(open.assetId)}`} onClose={close} wide>
          <AssetDividends c={c} assetId={open.assetId} />
        </Modal>
      )}
      {open?.action === 'sim' && (
        <Modal title={`Simula ${symbolOfId(open.assetId)}`} onClose={close} wide>
          <Simulator embedded presetAssetId={open.assetId} presetType={(c.result.positions[open.assetId]?.qty ?? 0) > 0 ? 'sell' : 'buy'} />
        </Modal>
      )}
    </section>
  )
}

const NONE = {}
