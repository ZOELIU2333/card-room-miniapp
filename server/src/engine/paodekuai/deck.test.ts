import { describe, it, expect } from 'vitest'
import { shuffle, deal, makeDeck } from './deck'
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

describe('makeDeck variants', () => {
  it('classic16 returns the full 52-card deck', () => {
    expect(makeDeck('classic16')).toHaveLength(52)
  })
  it('classic15 returns 45 cards', () => {
    expect(makeDeck('classic15')).toHaveLength(45)
  })
  it('classic15 keeps only spade 2 and spade A among 2s and As', () => {
    const d = makeDeck('classic15')
    const twos = d.filter((c) => c.rank === '2')
    const aces = d.filter((c) => c.rank === 'A')
    expect(twos).toHaveLength(1)
    expect(twos[0]!.suit).toBe('S')
    expect(aces).toHaveLength(1)
    expect(aces[0]!.suit).toBe('S')
  })
  it('classic15 drops exactly one K (3 remain) and keeps diamond 3', () => {
    const d = makeDeck('classic15')
    expect(d.filter((c) => c.rank === 'K')).toHaveLength(3)
    expect(d.some((c) => c.rank === '3' && c.suit === 'D')).toBe(true)
  })
})
