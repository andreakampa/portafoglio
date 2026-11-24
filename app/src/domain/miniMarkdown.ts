// Formattazione minima delle risposte dell'assistente (grassetto, corsivo, codice, titoli, elenchi, tabelle),
// senza HTML: il testo diventa una struttura che React mostra come elementi, quindi niente rischi di codice iniettato.

export type Inline = { t: 'text' | 'b' | 'i' | 'code'; v: string }
export type Block =
  | { t: 'h'; level: number; text: Inline[] }
  | { t: 'p'; text: Inline[] }
  | { t: 'ul'; items: Inline[][] }
  | { t: 'ol'; items: Inline[][] }
  | { t: 'table'; head: Inline[][]; rows: Inline[][][] }

export function parseInline(s: string): Inline[] {
  const out: Inline[] = []
  const re = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\*[^*\s][^*]*\*)/g
  let last = 0
  for (const m of s.matchAll(re)) {
    if (m.index! > last) out.push({ t: 'text', v: s.slice(last, m.index) })
    const tok = m[0]
    if (tok.startsWith('**') || tok.startsWith('__')) out.push({ t: 'b', v: tok.slice(2, -2) })
    else if (tok.startsWith('`')) out.push({ t: 'code', v: tok.slice(1, -1) })
    else out.push({ t: 'i', v: tok.slice(1, -1) })
    last = m.index! + tok.length
  }
  if (last < s.length) out.push({ t: 'text', v: s.slice(last) })
  return out
}

const cells = (line: string) => line.trim().replace(/^\||\|$/g, '').split('|').map(c => parseInline(c.trim()))
const isSep = (line: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line)

export function parseMarkdown(text: string): Block[] {
  const lines = text.replace(/\r/g, '').split('\n')
  const out: Block[] = []
  let para: string[] = []
  const flush = () => {
    if (para.length) out.push({ t: 'p', text: parseInline(para.join(' ')) })
    para = []
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const h = /^(#{1,4})\s+(.*)$/.exec(line)
    const ul = /^\s*[-*•]\s+(.*)$/.exec(line)
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    if (!line.trim()) {
      flush()
    } else if (h) {
      flush()
      out.push({ t: 'h', level: h[1]!.length, text: parseInline(h[2]!) })
    } else if (line.includes('|') && isSep(lines[i + 1] ?? '')) {
      flush()
      const head = cells(line)
      const rows: Inline[][][] = []
      i += 2
      while (i < lines.length && lines[i]!.includes('|') && lines[i]!.trim()) rows.push(cells(lines[i++]!))
      i -= 1
      out.push({ t: 'table', head, rows })
    } else if (ul || ol) {
      flush()
      const kind = ul ? 'ul' : 'ol'
      const prev = out.at(-1)
      const item = parseInline((ul ?? ol)![1]!)
      if (prev && prev.t === kind) prev.items.push(item)
      else out.push({ t: kind, items: [item] })
    } else {
      para.push(line.trim())
    }
  }
  flush()
  return out
}
