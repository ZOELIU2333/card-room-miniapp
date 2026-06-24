import type { GameEngine, RankEntry } from '../contract'
import type { GameState } from './state'
import { createInitialState } from './state'
import { applyAction, type PdkAction, type PdkEvent } from './rules'
import type { DeckVariant } from './deck'

export class PaodekuaiEngine implements GameEngine<GameState, PdkAction, PdkEvent, DeckVariant> {
  readonly kind = 'paodekuai'

  createInitialState(playerIds: string[], rng: () => number, variant: DeckVariant): GameState {
    return createInitialState(playerIds, rng, variant)
  }

  step(state: GameState, action: PdkAction) {
    return applyAction(state, action)
  }

  isFinished(state: GameState): boolean {
    return state.phase === 'FINISHED'
  }

  ranking(state: GameState): RankEntry[] {
    // 已出完者按 finishedRank；其余按手牌数升序补名次。
    // score：跑得快用负的剩牌数（手牌越少分越高，冠军为 0）。
    const ordered = state.players
      .map((p, i) => ({ p, i }))
      .sort((a, b) => {
        const ra = a.p.finishedRank, rb = b.p.finishedRank
        if (ra && rb) return ra - rb
        if (ra) return -1
        if (rb) return 1
        return a.p.hand.length - b.p.hand.length
      })
    return ordered.map(({ p }, idx) => ({
      playerId: p.id,
      rank: idx + 1,
      score: -p.hand.length,
    }))
  }
}
