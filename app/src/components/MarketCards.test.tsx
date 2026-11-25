import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MarketKpi } from './MarketCards'
import type { Quote } from '../lib/prices'

const tile = { symbol: 'BTC-USD', name: 'BTC ($)', decimals: 0 }
const q = (price: number, previousClose = 100): Quote => ({ symbol: 'BTC-USD', price, previousClose, currency: 'USD', time: 0 })

describe('riquadro del pannello Mercati', () => {
  it('variazione del giorno verde se positiva, rossa se negativa', () => {
    const { rerender } = render(<MarketKpi tile={tile} quote={q(110)} />)
    expect(screen.getByText('+10,00% oggi').className).toContain('pos')
    rerender(<MarketKpi tile={tile} quote={q(90)} />)
    expect(screen.getByText('-10,00% oggi').className).toContain('neg')
  })

  it('il prezzo lampeggia verde quando sale e rosso quando scende', () => {
    const { rerender } = render(<MarketKpi tile={tile} quote={q(100)} />)
    const value = screen.getByText('100')
    expect(value.className).not.toMatch(/flash/)
    rerender(<MarketKpi tile={tile} quote={q(105)} />)
    expect(value.className).toContain('flash-up')
    rerender(<MarketKpi tile={tile} quote={q(101)} />)
    expect(value.className).toContain('flash-down')
    expect(value.className).not.toContain('flash-up')
  })
})
