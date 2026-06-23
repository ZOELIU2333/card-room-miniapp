import type { Card } from './card'
import { cardId } from './card'
import { identifyCombo, canBeat, type ComboType } from './combo'
import type { GameState } from './state'

export type PdkAction =
  | { type: 'PLAY'; playerIndex: number; cards: Card[] }
  | { type: 'PASS'; playerIndex: number }
  | { type: 'TIMEOUT' } // 系统动作：房间层计时器触发。跑得快无等待窗口，视为 no-op。

export type RejectReason =
  | 'NOT_YOUR_TURN' | 'NOT_IN_HAND' | 'ILLEGAL_COMBO' | 'CANNOT_BEAT'
  | 'GAME_FINISHED' | 'MUST_PLAY_ON_LEAD' | 'NO_OP'

export type PdkEvent =
  | { type: 'PLAYED'; playerIndex: number; comboType: ComboType }
  | { type: 'PASSED'; playerIndex: number }
  | { type: 'REJECTED'; reason: RejectReason }
  | { type: 'TABLE_CLEARED'; leadPlayer: number }
  | { type: 'PLAYER_FINISHED'; playerIndex: number; rank: number }
  | { type: 'GAME_OVER' }

export interface ApplyResult { state: GameState; events: PdkEvent[] }

function reject(state: GameState, reason: RejectReason): ApplyResult {
  return { state, events: [{ type: 'REJECTED', reason }] }
}

function handHasAll(hand: Card[], cards: Card[]): boolean {
  const pool = new Map<string, number>()
  for (const c of hand) pool.set(cardId(c), (pool.get(cardId(c)) ?? 0) + 1)
  for (const c of cards) {
    const k = cardId(c); const n = pool.get(k) ?? 0
    if (n <= 0) return false
    pool.set(k, n - 1)
  }
  return true
}

function removeCards(hand: Card[], cards: Card[]): Card[] {
  const toRemove = new Map<string, number>()
  for (const c of cards) toRemove.set(cardId(c), (toRemove.get(cardId(c)) ?? 0) + 1)
  const out: Card[] = []
  for (const c of hand) {
    const k = cardId(c); const n = toRemove.get(k) ?? 0
    if (n > 0) { toRemove.set(k, n - 1); continue }
    out.push(c)
  }
  return out
}

function nextPlayer(state: GameState, from: number): number {
  return (from + 1) % state.players.length
}

export function applyAction(state: GameState, action: PdkAction): ApplyResult {
  if (state.phase === 'FINISHED') return reject(state, 'GAME_FINISHED')
  if (action.type === 'TIMEOUT') return reject(state, 'NO_OP')
  if (action.playerIndex !== state.currentPlayer) return reject(state, 'NOT_YOUR_TURN')

  if (action.type === 'PLAY') {
    const player = state.players[action.playerIndex]!
    if (!handHasAll(player.hand, action.cards)) return reject(state, 'NOT_IN_HAND')
    const combo = identifyCombo(action.cards)
    if (!combo) return reject(state, 'ILLEGAL_COMBO')
    if (state.lastPlay && !canBeat(combo, state.lastPlay.combo)) return reject(state, 'CANNOT_BEAT')

    const newHand = removeCards(player.hand, action.cards)
    const players = state.players.map((p, i) => i === action.playerIndex ? { ...p, hand: newHand } : p)
    const events: PdkEvent[] = [{ type: 'PLAYED', playerIndex: action.playerIndex, comboType: combo.type }]

    let finishedCount = state.finishedCount
    if (newHand.length === 0) {
      finishedCount += 1
      players[action.playerIndex] = { ...players[action.playerIndex]!, finishedRank: finishedCount }
      events.push({ type: 'PLAYER_FINISHED', playerIndex: action.playerIndex, rank: finishedCount })
    }

    if (finishedCount >= 1) {
      return {
        state: { ...state, players, finishedCount, phase: 'FINISHED',
          lastPlay: { playerIndex: action.playerIndex, combo } },
        events: [...events, { type: 'GAME_OVER' }],
      }
    }

    return {
      state: { ...state, players,
        lastPlay: { playerIndex: action.playerIndex, combo },
        passesSinceLastPlay: 0,
        currentPlayer: nextPlayer(state, action.playerIndex),
        finishedCount },
      events,
    }
  }

  // PASS
  if (!state.lastPlay) return reject(state, 'MUST_PLAY_ON_LEAD')
  const passes = state.passesSinceLastPlay + 1
  const events: PdkEvent[] = [{ type: 'PASSED', playerIndex: action.playerIndex }]
  if (passes >= state.players.length - 1) {
    return {
      state: { ...state, lastPlay: null, passesSinceLastPlay: 0, currentPlayer: state.lastPlay.playerIndex },
      events: [...events, { type: 'TABLE_CLEARED', leadPlayer: state.lastPlay.playerIndex }],
    }
  }
  return {
    state: { ...state, passesSinceLastPlay: passes, currentPlayer: nextPlayer(state, action.playerIndex) },
    events,
  }
}
