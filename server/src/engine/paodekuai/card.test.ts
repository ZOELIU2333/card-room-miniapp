import { describe, it, expect } from 'vitest'
import { makeFullDeck, rankValue, type Card } from './card'

describe('card', () => {
  it('full deck has 52 unique cards (no jokers)', () => {
    const deck = makeFullDeck()
    expect(deck).toHaveLength(52)
    expect(new Set(deck.map((c) => c.id)).size).toBe(52)
  })
  it('rank ordering: 3 lowest, 2 highest', () => {
    expect(rankValue('3')).toBeLessThan(rankValue('4'))
    expect(rankValue('A')).toBeLessThan(rankValue('2'))
    expect(rankValue('K')).toBeLessThan(rankValue('A'))
  })
  it('deck contains diamond 3', () => {
    const c: Card = { rank: '3', suit: 'D' }
    expect(makeFullDeck().some((x) => x.rank === c.rank && x.suit === c.suit)).toBe(true)
  })
})
