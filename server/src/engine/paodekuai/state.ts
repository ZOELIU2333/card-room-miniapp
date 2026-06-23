import type { Card } from './card'
import type { Combo } from './combo'
import { makeFullDeck } from './card'
import { shuffle, deal } from './deck'

export type Phase = 'PLAYING' | 'FINISHED'

export interface PlayerState {
  id: string
  hand: Card[]
  finishedRank: number | null
}

export interface LastPlay { playerIndex: number; combo: Combo }

export interface GameState {
  players: PlayerState[]
  kitty: Card[]
  currentPlayer: number
  lastPlay: LastPlay | null
  passesSinceLastPlay: number
  phase: Phase
  finishedCount: number
}

export function createInitialState(playerIds: string[], rng: () => number): GameState {
  const { hands, kitty } = deal(shuffle(makeFullDeck(), rng), playerIds.length, 16)
  const players: PlayerState[] = playerIds.map((id, i) => ({
    id, hand: hands[i]!, finishedRank: null,
  }))
  const first = players.findIndex((p) => p.hand.some((c) => c.rank==='3' && c.suit==='D'))
  return {
    players, kitty,
    currentPlayer: first === -1 ? 0 : first,
    lastPlay: null, passesSinceLastPlay: 0, phase: 'PLAYING', finishedCount: 0,
  }
}
