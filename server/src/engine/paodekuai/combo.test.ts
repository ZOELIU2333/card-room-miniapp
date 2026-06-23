import { describe, it, expect } from 'vitest'
import { identifyCombo } from './combo'
import type { Card } from './card'

const c = (rank: Card['rank'], suit: Card['suit'] = 'C'): Card => ({ rank, suit })

describe('identifyCombo', () => {
  it('single', () => { expect(identifyCombo([c('5')])).toMatchObject({ type: 'SINGLE' }) })
  it('pair', () => { expect(identifyCombo([c('7','C'),c('7','D')])).toMatchObject({ type: 'PAIR' }) })
  it('non-pair two cards invalid', () => { expect(identifyCombo([c('7'),c('8')])).toBeNull() })
  it('triple', () => { expect(identifyCombo([c('9','C'),c('9','D'),c('9','H')])).toMatchObject({ type: 'TRIPLE' }) })
  it('triple+single', () => { expect(identifyCombo([c('9','C'),c('9','D'),c('9','H'),c('4')])).toMatchObject({ type: 'TRIPLE_SINGLE' }) })
  it('straight of 5', () => { expect(identifyCombo([c('3'),c('4'),c('5'),c('6'),c('7')])).toMatchObject({ type: 'STRAIGHT' }) })
  it('straight cannot include 2', () => { expect(identifyCombo([c('J'),c('Q'),c('K'),c('A'),c('2')])).toBeNull() })
  it('bomb', () => { expect(identifyCombo([c('5','C'),c('5','D'),c('5','H'),c('5','S')])).toMatchObject({ type: 'BOMB' }) })
})
