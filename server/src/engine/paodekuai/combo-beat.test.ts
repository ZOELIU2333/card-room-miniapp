import { describe, it, expect } from 'vitest'
import { identifyCombo, canBeat } from './combo'
import type { Card } from './card'

const c = (rank: Card['rank'], suit: Card['suit'] = 'C'): Card => ({ rank, suit })
const combo = (cards: Card[]) => identifyCombo(cards)!

describe('canBeat', () => {
  it('higher single beats lower', () => {
    expect(canBeat(combo([c('8')]), combo([c('5')]))).toBe(true)
    expect(canBeat(combo([c('5')]), combo([c('8')]))).toBe(false)
  })
  it('different non-bomb type cannot beat', () => {
    expect(canBeat(combo([c('5','C'),c('5','D')]), combo([c('9')]))).toBe(false)
  })
  it('straight must match length', () => {
    const s5 = combo([c('3'),c('4'),c('5'),c('6'),c('7')])
    const s6 = combo([c('3'),c('4'),c('5'),c('6'),c('7'),c('8')])
    expect(canBeat(s6, s5)).toBe(false)
  })
  it('bomb beats non-bomb', () => {
    const bomb = combo([c('5','C'),c('5','D'),c('5','H'),c('5','S')])
    expect(canBeat(bomb, combo([c('2')]))).toBe(true)
  })
  it('bigger bomb beats smaller', () => {
    const b5 = combo([c('5','C'),c('5','D'),c('5','H'),c('5','S')])
    const b9 = combo([c('9','C'),c('9','D'),c('9','H'),c('9','S')])
    expect(canBeat(b9, b5)).toBe(true)
    expect(canBeat(b5, b9)).toBe(false)
  })
})
