import { describe, it, expect } from 'vitest'
import { shuffle, deal } from './deck'
import { makeFullDeck } from './card'

function seededRandom(seed: number): () => number {
  let s = seed >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0xffffffff }
}

describe('deck', () => {
  it('shuffle deterministic given same seed', () => {
    const a = shuffle(makeFullDeck(), seededRandom(42))
    const b = shuffle(makeFullDeck(), seededRandom(42))
    expect(a.map((c) => c.id)).toEqual(b.map((c) => c.id))
  })
  it('shuffle preserves all 52 cards', () => {
    expect(new Set(shuffle(makeFullDeck(), seededRandom(7)).map((c) => c.id)).size).toBe(52)
  })
  it('deal: 3 players 16 each, 4 in kitty', () => {
    const { hands, kitty } = deal(shuffle(makeFullDeck(), seededRandom(1)), 3, 16)
    expect(hands).toHaveLength(3)
    for (const h of hands) expect(h).toHaveLength(16)
    expect(kitty).toHaveLength(4)
  })
})
