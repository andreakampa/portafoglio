import { describe, expect, it } from 'vitest'
import { parseInline, parseMarkdown } from './miniMarkdown'

describe('formattazione delle risposte', () => {
  it('grassetto, corsivo e codice nel testo', () => {
    expect(parseInline('Il **PMC** è *stimato* con `LIFO`.')).toEqual([
      { t: 'text', v: 'Il ' }, { t: 'b', v: 'PMC' }, { t: 'text', v: ' è ' }, { t: 'i', v: 'stimato' },
      { t: 'text', v: ' con ' }, { t: 'code', v: 'LIFO' }, { t: 'text', v: '.' },
    ])
    expect(parseInline('3 * 4 = 12')).toEqual([{ t: 'text', v: '3 * 4 = 12' }])
  })

  it('titoli, paragrafi, elenchi puntati e numerati', () => {
    const b = parseMarkdown('## Sintesi\nRiga uno\nriga due\n\n- primo\n- **secondo**\n\n1. uno\n2) due')
    expect(b.map(x => x.t)).toEqual(['h', 'p', 'ul', 'ol'])
    expect(b[1]).toEqual({ t: 'p', text: [{ t: 'text', v: 'Riga uno riga due' }] })
    expect(b[2]).toMatchObject({ items: [[{ t: 'text', v: 'primo' }], [{ t: 'b', v: 'secondo' }]] })
    expect((b[3] as { items: unknown[] }).items).toHaveLength(2)
  })

  it('tabelle', () => {
    const b = parseMarkdown('| Titolo | Peso |\n|---|:--:|\n| NVDA | 12% |\n| AMD | 8% |\n\nFine')
    expect(b[0]).toMatchObject({ t: 'table', head: [[{ v: 'Titolo' }], [{ v: 'Peso' }]] })
    expect((b[0] as { rows: unknown[] }).rows).toHaveLength(2)
    expect(b[1]!.t).toBe('p')
  })
})
