import type { Card } from './card'
import type { Combo } from './combo'
import { shuffle, deal, makeDeck, type DeckVariant } from './deck'

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

export function createInitialState(playerIds: string[], rng: () => number, variant: DeckVariant): GameState {
  const perPlayer = variant === 'classic15' ? 15 : 16
  const { hands, kitty } = deal(shuffle(makeDeck(variant), rng), playerIds.length, perPlayer)
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
