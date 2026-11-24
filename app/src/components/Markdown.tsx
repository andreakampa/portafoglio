import { parseMarkdown, type Inline } from '../domain/miniMarkdown'

const inl = (xs: Inline[]) =>
  xs.map((x, i) => (x.t === 'b' ? <b key={i}>{x.v}</b> : x.t === 'i' ? <i key={i}>{x.v}</i> : x.t === 'code' ? <code key={i}>{x.v}</code> : <span key={i}>{x.v}</span>))

/** Risposta dell'assistente con grassetto, elenchi e tabelle (niente HTML grezzo). */
export function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      {parseMarkdown(text).map((b, i) => {
        if (b.t === 'h') return b.level <= 2 ? <h3 key={i}>{inl(b.text)}</h3> : <h4 key={i}>{inl(b.text)}</h4>
        if (b.t === 'p') return <p key={i}>{inl(b.text)}</p>
        if (b.t === 'ul') return <ul key={i}>{b.items.map((it, k) => <li key={k}>{inl(it)}</li>)}</ul>
        if (b.t === 'ol') return <ol key={i}>{b.items.map((it, k) => <li key={k}>{inl(it)}</li>)}</ol>
        return (
          <div key={i} className="md-table">
            <table>
              <thead><tr>{b.head.map((h, k) => <th key={k}>{inl(h)}</th>)}</tr></thead>
              <tbody>{b.rows.map((r, k) => <tr key={k}>{r.map((cell, j) => <td key={j}>{inl(cell)}</td>)}</tr>)}</tbody>
            </table>
          </div>
        )
      })}
    </div>
  )
}
