import type { GameEngine } from '../engine/contract'
import type { GameState } from '../engine/paodekuai/state'
import type { PdkAction, PdkEvent } from '../engine/paodekuai/rules'
import { rankValue } from '../engine/paodekuai/card'

// 超时/断线代打：选一个合法动作。贪心——按牌力升序逐张试单张 PLAY，
// 第一个不被引擎判 REJECTED 的即采用；全被拒则 PASS。只求合法不求最优。
// 仅依赖引擎的 step 判定，不扩展引擎契约。
export function chooseAutoMove(
  engine: GameEngine<GameState, PdkAction, PdkEvent>,
  state: GameState,
  playerIndex: number,
): PdkAction {
  const hand = state.players[playerIndex]!.hand
  const sorted = [...hand].sort((a, b) => rankValue(a.rank) - rankValue(b.rank))
  for (const c of sorted) {
    const candidate: PdkAction = { type: 'PLAY', playerIndex, cards: [c] }
    const { events } = engine.step(state, candidate)
    if (!events.some((e) => e.type === 'REJECTED')) return candidate
  }
  return { type: 'PASS', playerIndex }
}
