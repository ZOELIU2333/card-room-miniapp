import { describe, it, expect } from 'vitest'
import { chooseAutoMove } from './autoplay'
import { PaodekuaiEngine } from '../engine/paodekuai/engine'
import type { GameState, PlayerState } from '../engine/paodekuai/state'
import type { Card } from '../engine/paodekuai/card'

const card = (rank: Card['rank'], suit: Card['suit'] = 'C'): Card => ({ rank, suit })
const engine = new PaodekuaiEngine()

describe('chooseAutoMove', () => {
  it('lead: plays the smallest legal single', () => {
    const players: PlayerState[] = [
      { id: 'p1', hand: [card('9'), card('5'), card('K')], finishedRank: null },
      { id: 'p2', hand: [card('4')], finishedRank: null },
      { id: 'p3', hand: [card('6')], finishedRank: null },
    ]
    const st: GameState = { players, kitty: [], currentPlayer: 0, lastPlay: null,
      passesSinceLastPlay: 0, phase: 'PLAYING', finishedCount: 0 }
    const action = chooseAutoMove(engine, st, 0)
    // 首家无人可压，必出最小单张 5（不是 PASS）
    expect(action).toEqual({ type: 'PLAY', playerIndex: 0, cards: [card('5')] })
  })

  it('following and cannot beat: returns PASS', () => {
    const players: PlayerState[] = [
      { id: 'p1', hand: [card('K')], finishedRank: null },
      { id: 'p2', hand: [card('4'), card('5')], finishedRank: null },
      { id: 'p3', hand: [card('6')], finishedRank: null },
    ]
    const st: GameState = { players, kitty: [], currentPlayer: 1,
      lastPlay: { playerIndex: 0, combo: { type: 'SINGLE', power: 11, length: 1, cards: [card('K')] } },
      passesSinceLastPlay: 0, phase: 'PLAYING', finishedCount: 0 }
    const action = chooseAutoMove(engine, st, 1)
    expect(action).toEqual({ type: 'PASS', playerIndex: 1 })
  })

  it('following and can beat: plays the smallest card that beats', () => {
    const players: PlayerState[] = [
      { id: 'p1', hand: [card('8')], finishedRank: null },
      { id: 'p2', hand: [card('6'), card('9'), card('Q')], finishedRank: null },
      { id: 'p3', hand: [card('3')], finishedRank: null },
    ]
    const st: GameState = { players, kitty: [], currentPlayer: 1,
      lastPlay: { playerIndex: 0, combo: { type: 'SINGLE', power: 5, length: 1, cards: [card('8')] } },
      passesSinceLastPlay: 0, phase: 'PLAYING', finishedCount: 0 }
    const action = chooseAutoMove(engine, st, 1)
    // 6 压不过 8，9 是能压的最小单张
    expect(action).toEqual({ type: 'PLAY', playerIndex: 1, cards: [card('9')] })
  })
})
