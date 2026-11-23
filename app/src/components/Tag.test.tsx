import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { KIND_LABEL } from '../domain/engine/movements'
import { KIND_TONE, Tag, type Tone } from './Tag'
// @ts-expect-error: i tipi di Node non sono inclusi nel progetto del browser
import { readFileSync } from 'node:fs'

const css: string = readFileSync('src/index.css', 'utf8')
const TONES: Tone[] = ['buy', 'sell', 'short', 'cover', 'transfer', 'dividend', 'sim', 'history', 'edit', 'delete', 'neutral']

describe('Tag', () => {
  it('ha uno stile per ogni significato', () => {
    for (const t of TONES) expect(css).toContain(`.tag-${t}`)
  })

  it('ogni tipo di movimento ha un tono; trasferimenti in entrata e uscita uguali, short e chiusura distinti', () => {
    for (const k of Object.keys(KIND_LABEL)) expect(KIND_TONE[k as keyof typeof KIND_TONE]).toBeDefined()
    expect(KIND_TONE.transfer_in).toBe(KIND_TONE.transfer_out)
    expect(KIND_TONE.short_sell).not.toBe(KIND_TONE.buy_to_cover)
    expect(KIND_TONE.buy).not.toBe(KIND_TONE.sell)
  })

  it('mostra sempre un\'icona accanto al testo', () => {
    const { container } = render(<Tag tone="buy">Acquisto</Tag>)
    expect(screen.getByText('Acquisto')).toHaveClass('tag', 'tag-buy')
    expect(container.querySelector('svg.tag-ic')).not.toBeNull()
  })

  it('il verde acqua non colora più badge e tipi di movimento', () => {
    expect(css).not.toMatch(/\.kind-[a-z_]+[^{]*\{[^}]*var\(--primary\)/)
    expect(css).not.toMatch(/\.badge \{[^}]*var\(--primary\)/)
  })
})
