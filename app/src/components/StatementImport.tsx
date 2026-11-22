import { useRef, useState } from 'react'
import { useSaveStatement, type StoredStatement } from '../data/taxStatements'
import type { CashflowLike } from '../domain/engine/dividends'
import type { RawPortfolio } from '../domain/engine/portfolio'
import type { RawAsset } from '../domain/engine/types'
import { useBonusGrants } from '../data/useBonusGrants'
import { checkStatement, grantsOf, parseStatement, summarizeStatement } from '../domain/ibkr/statement'
import { money, qty } from '../lib/format'

interface Props {
  pid: string
  year: number
  portfolio: RawPortfolio
  statement: StoredStatement | null | undefined
  /** Titoli valutati col prezzo del rendiconto (dal calcolo del quadro RW). */
  closesUsed: number | null
}

const it = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('it-IT')

/** Importa il rendiconto di attività IBKR (CSV) per un anno, lo confronta con l'app e ne salva il riassunto. */
export function StatementImport({ pid, year, portfolio, statement, closesUsed }: Props) {
  const save = useSaveStatement()
  const { save: saveGrants } = useBonusGrants()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onFile = async (file: File | undefined) => {
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      const st = parseStatement(await file.text())
      if (st.from.slice(0, 4) !== String(year) || st.to.slice(0, 4) !== String(year)) {
        throw new Error(`Il rendiconto va dal ${it(st.from)} al ${it(st.to)}: scegli l'anno giusto in alto oppure scarica il rendiconto del ${year}.`)
      }
      const assets = (portfolio.assets ?? {}) as Record<string, RawAsset & { isin?: string }>
      const flows = Object.values(((portfolio as { cashflows?: unknown }).cashflows ?? {}) as Record<string, CashflowLike>)
      const check = checkStatement(st, assets, flows)
      await save(pid, year, { ...summarizeStatement(st, assets, new Date().toISOString()), check })
      const grants = grantsOf(st)
      if (grants.length) await saveGrants(pid, grants)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  const c = statement?.check
  const diffs = c ? (c.trades?.length ?? 0) + (c.cash?.length ?? 0) + (c.positions?.length ?? 0) : 0

  return (
    <div className="card">
      <h2>Rendiconto IBKR {year}</h2>
      {statement === undefined ? (
        <p className="muted">Caricamento…</p>
      ) : !statement || !c ? (
        <p className="small">
          Importa il <b>rendiconto di attività</b> di IBKR: il sito lo confronta con i movimenti dell’app e, se arriva al 31/12,
          usa i suoi prezzi di fine anno per il quadro RW. I calcoli restano quelli del prospetto.
        </p>
      ) : (
        <>
          <p className="small">
            Importato il {new Date(statement.importedAt).toLocaleDateString('it-IT')} · periodo dal {it(statement.from)} al {it(statement.to)}.
          </p>
          {diffs === 0 ? (
            <p className="pos small">
              Tutto torna: {c.tradesChecked} operazioni, dividendi, ritenute, interessi e {c.positionsChecked} posizioni coincidono con l’app.
            </p>
          ) : (
            <div className="card warn">
              <b>{diffs} differenze tra il rendiconto e l’app</b> (su {c.tradesChecked} operazioni e {c.positionsChecked} posizioni):
              <ul>
                {(c.trades ?? []).map(d => (
                  <li key={`t${d.symbol}${d.date}`}>
                    {d.symbol} il {it(d.date)}: nel rendiconto {qty(d.statementQty)}, nell’app {qty(d.appQty)}
                    {d.assetId ? '' : ' (titolo non presente nell’app)'}
                  </li>
                ))}
                {(c.cash ?? []).map(d => (
                  <li key={`c${d.kind}${d.currency}`}>
                    {d.kind} in {d.currency}: nel rendiconto {money(d.statement, d.currency)}, nell’app {money(d.app, d.currency)}
                  </li>
                ))}
                {(c.positions ?? []).map(d => (
                  <li key={`p${d.symbol}`}>
                    {d.symbol} al {it(c.to)}: nel conto {qty(d.statementQty)}, nell’app {qty(d.appQty)}
                    {d.assetId ? '' : ' (titolo non presente nell’app)'}
                  </li>
                ))}
              </ul>
              <p className="small">Correggi i movimenti nella pagina Movimenti (o chiedi a Claude), poi importa di nuovo il rendiconto.</p>
            </div>
          )}
          {(c.unvested ?? []).length > 0 && (
            <p className="muted small">
              Azioni premio non ancora maturate (giustamente non nell’app fino alla maturazione):{' '}
              {(c.unvested ?? []).map(u => `${qty(u.qty)} ${u.symbol}, la prima matura il ${it(u.nextVest)}`).join('; ')}.
            </p>
          )}
          {c.yearEnd ? (
            <p className="muted small">Quadro RW: {closesUsed ?? Object.keys(statement.closes ?? {}).length} titoli valutati col prezzo di chiusura al 31/12 del rendiconto.</p>
          ) : (
            <p className="muted small">Il rendiconto arriva al {it(statement.to)}: per i valori di fine anno del quadro RW importa quello fino al 31/12.</p>
          )}
        </>
      )}
      {error && <p className="neg small">{error}</p>}
      <input ref={input} type="file" accept=".csv,text/csv" hidden onChange={e => void onFile(e.target.files?.[0])} />
      <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? 'Importazione…' : statement ? 'Importa di nuovo' : 'Importa rendiconto (CSV)'}
      </button>
      <details>
        <summary className="small">Come scaricarlo da IBKR</summary>
        <p className="small">
          Portale IBKR → Rendiconti → <b>Rendiconto di attività</b> → periodo «Annuale» (o personalizzato dal 1/1) →
          formato <b>CSV</b>, lingua <b>italiano</b> → Esegui. Il file resta sul tuo dispositivo: il sito salva solo i prezzi di fine periodo
          e l’esito del confronto.
        </p>
      </details>
    </div>
  )
}
