import { describe, it, expect } from 'vitest'
import { createInitialState } from './state'

function seededRandom(seed: number): () => number {
  let s = seed >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0xffffffff }
}

describe('createInitialState', () => {
  it('3 players each 16 cards, 4 in kitty', () => {
    const st = createInitialState(['p1','p2','p3'], seededRandom(1))
    expect(st.players).toHaveLength(3)
    for (const p of st.players) expect(p.hand).toHaveLength(16)
    expect(st.kitty).toHaveLength(4)
  })
  it('first player holds diamond 3', () => {
    const st = createInitialState(['p1','p2','p3'], seededRandom(1))
    const holder = st.players.findIndex((p) => p.hand.some((c) => c.rank==='3' && c.suit==='D'))
    expect(st.currentPlayer).toBe(holder)
  })
  it('starts PLAYING with empty table', () => {
    const st = createInitialState(['p1','p2','p3'], seededRandom(1))
    expect(st.phase).toBe('PLAYING')
    expect(st.lastPlay).toBeNull()
  })
})
