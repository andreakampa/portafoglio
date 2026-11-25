import type { MovementKind } from '../domain/engine/movements'

export type Tone = 'buy' | 'sell' | 'short' | 'cover' | 'transfer' | 'dividend' | 'sim' | 'history' | 'edit' | 'confirm' | 'delete' | 'neutral'

/** Tono di ogni tipo di movimento. L'esercizio di opzioni resta neutro. */
export const KIND_TONE: Record<MovementKind, Tone> = {
  buy: 'buy',
  sell: 'sell',
  short_sell: 'short',
  buy_to_cover: 'cover',
  transfer_in: 'transfer',
  transfer_out: 'transfer',
  exercise: 'neutral',
}
