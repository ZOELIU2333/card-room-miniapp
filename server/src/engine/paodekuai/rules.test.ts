import { describe, it, expect } from 'vitest'
import { applyAction, type PdkAction } from './rules'
import type { GameState, PlayerState } from './state'
import type { Card } from './card'

const card = (rank: Card['rank'], suit: Card['suit'] = 'C'): Card => ({ rank, suit })

function fixedState(): GameState {
  const players: PlayerState[] = [
    { id: 'p1', hand: [card('5'),card('6'),card('7')], finishedRank: null },
    { id: 'p2', hand: [card('8'),card('9'),card('10')], finishedRank: null },
    { id: 'p3', hand: [card('J'),card('Q'),card('K')], finishedRank: null },
  ]
  return { players, kitty: [], currentPlayer: 0, lastPlay: null,
    passesSinceLastPlay: 0, phase: 'PLAYING', finishedCount: 0 }
}

describe('applyAction - PLAY', () => {
  it('valid lead removes cards and advances turn', () => {
    const { state, events } = applyAction(fixedState(), { type: 'PLAY', playerIndex: 0, cards: [card('5')] })
    expect(state.players[0]!.hand).toHaveLength(2)
    expect(state.currentPlayer).toBe(1)
    expect(state.lastPlay?.combo.type).toBe('SINGLE')
    expect(events).toContainEqual({ type: 'PLAYED', playerIndex: 0, comboType: 'SINGLE' })
  })
  it('rejects out of turn', () => {
    const { state, events } = applyAction(fixedState(), { type: 'PLAY', playerIndex: 1, cards: [card('8')] })
    expect(state.players[1]!.hand).toHaveLength(3)
    expect(events).toContainEqual({ type: 'REJECTED', reason: 'NOT_YOUR_TURN' })
  })
  it('rejects cards not in hand', () => {
    const { events } = applyAction(fixedState(), { type: 'PLAY', playerIndex: 0, cards: [card('2')] })
    expect(events).toContainEqual({ type: 'REJECTED', reason: 'NOT_IN_HAND' })
  })
  it('rejects illegal combo', () => {
    const { events } = applyAction(fixedState(), { type: 'PLAY', playerIndex: 0, cards: [card('5'),card('7')] })
    expect(events).toContainEqual({ type: 'REJECTED', reason: 'ILLEGAL_COMBO' })
  })
  it('rejects following play that cannot beat', () => {
    let st = applyAction(fixedState(), { type: 'PLAY', playerIndex: 0, cards: [card('7')] }).state
    st.players[1]!.hand = [card('4'),card('9'),card('10')]
    const r = applyAction(st, { type: 'PLAY', playerIndex: 1, cards: [card('4')] })
    expect(r.events).toContainEqual({ type: 'REJECTED', reason: 'CANNOT_BEAT' })
  })
})

describe('applyAction - PASS', () => {
  function leadState(): GameState {
    const players: PlayerState[] = [
      { id: 'p1', hand: [card('K')], finishedRank: null },
      { id: 'p2', hand: [card('4'),card('5')], finishedRank: null },
      { id: 'p3', hand: [card('6'),card('7')], finishedRank: null },
    ]
    return { players, kitty: [], currentPlayer: 1,
      lastPlay: { playerIndex: 0, combo: { type: 'SINGLE', power: 11, length: 1, cards: [card('K')] } },
      passesSinceLastPlay: 0, phase: 'PLAYING', finishedCount: 0 }
  }
  it('pass advances turn and increments count', () => {
    const { state, events } = applyAction(leadState(), { type: 'PASS', playerIndex: 1 })
    expect(state.currentPlayer).toBe(2)
    expect(state.passesSinceLastPlay).toBe(1)
    expect(events).toContainEqual({ type: 'PASSED', playerIndex: 1 })
  })
  it('cannot pass on lead', () => {
    const st = leadState(); st.lastPlay = null; st.currentPlayer = 0
    const { events } = applyAction(st, { type: 'PASS', playerIndex: 0 })
    expect(events).toContainEqual({ type: 'REJECTED', reason: 'MUST_PLAY_ON_LEAD' })
  })
  it('all others pass clears table back to last player', () => {
    let st = applyAction(leadState(), { type: 'PASS', playerIndex: 1 }).state
    const r = applyAction(st, { type: 'PASS', playerIndex: 2 })
    expect(r.state.lastPlay).toBeNull()
    expect(r.state.currentPlayer).toBe(0)
    expect(r.events).toContainEqual({ type: 'TABLE_CLEARED', leadPlayer: 0 })
  })
})

describe('applyAction - TIMEOUT', () => {
  it('TIMEOUT on lead is treated as no-op reject (paodekuai has no wait window)', () => {
    const st = fixedState()
    const { state, events } = applyAction(st, { type: 'TIMEOUT' })
    expect(state).toEqual(st)
    expect(events).toContainEqual({ type: 'REJECTED', reason: 'NO_OP' })
  })
})
