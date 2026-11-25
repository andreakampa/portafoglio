import { useIbkrSync } from '../data/useIbkrSync'
import { syncHeadline } from '../domain/ibkrSync'

const when = (iso?: string) => (iso ? new Date(iso).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' }) : '')

/** Esito dell'ultima sincronizzazione automatica IBKR. Non compare per chi non ha mai sincronizzato. */
export function IbkrSyncNotice() {
  const s = useIbkrSync()
  if (!s) return null

  const hasDetails = s.added.length + s.review.length + s.skipped.length > 0
  return (
    <>
      {s.lastError && (
        <div className="card error" role="alert">
          <b>Sincronizzazione IBKR non riuscita</b> ({when(s.lastError.at)}): {s.lastError.message}
        </div>
      )}
      {s.lastRun && s.paused && (
        <div className="card">
          <b>Sincronizzazione IBKR in pausa</b> (ultimo controllo {when(s.lastRun)}): si riattiva da Impostazioni → Portafogli.
        </div>
      )}
      {s.lastRun && !s.paused && (
        <details className={`card${s.review.length ? ' warn' : ''}`}>
          <summary>
            IBKR, {when(s.lastRun)}: {syncHeadline(s)}
          </summary>
          {hasDetails ? (
            <>
              <Section title="Importate" items={s.added} />
              <Section title="Da controllare" items={s.review} />
              <Section title="Non gestite" items={s.skipped} />
            </>
          ) : (
            <p className="muted">Nessuna novità.</p>
          )}
        </details>
      )}
    </>
  )
}

function Section({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null
  return (
    <>
      <h3>{title}</h3>
      <ul>
        {items.map((t, i) => (
          <li key={i}>{t}</li>
        ))}
      </ul>
    </>
  )
}
