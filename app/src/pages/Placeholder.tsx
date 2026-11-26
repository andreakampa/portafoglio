import { OLD_SITE_URL } from '../lib/site'

export function Placeholder({ title, what }: { title: string; what: string }) {
  return (
    <section className="page">
      <header className="page-head">
        <h1>{title}</h1>
      </header>
      <div className="card">
        <p>{what}</p>
        <p className="muted">Questa sezione è in costruzione. Nel frattempo usa il sito attuale.</p>
        <a className="btn btn-ghost" href={OLD_SITE_URL}>
          Apri il sito attuale
        </a>
      </div>
    </section>
  )
}
