// contract.test.ts
import { describe, it, expect } from 'vitest'
import type { GameEngine } from './contract'
import { PaodekuaiEngine } from './paodekuai/engine'
import type { GameState } from './paodekuai/state'
import type { PdkAction, PdkEvent } from './paodekuai/rules'

function seededRandom(seed: number): () => number {
  let s = seed >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0xffffffff }
}

describe('PaodekuaiEngine satisfies GameEngine contract', () => {
  // 只用接口类型持有，房间层将来就是这样用——编译通过即证明可替换
  const engine: GameEngine<GameState, PdkAction, PdkEvent> = new PaodekuaiEngine()

  it('kind is paodekuai', () => {
    expect(engine.kind).toBe('paodekuai')
  })

  it('createInitialState + step + isFinished + ranking work through the interface', () => {
    let st = engine.createInitialState(['p1','p2','p3'], seededRandom(123))
    expect(engine.isFinished(st)).toBe(false)

    let over = false, guard = 0
    while (!over && guard < 2000) {
      guard++
      const cur = st.currentPlayer
      const hand = st.players[cur]!.hand
      // 贪心：能出最小单张就出，否则 pass
      const sorted = [...hand].sort((a, b) =>
        a.rank.localeCompare(b.rank)) // 仅需稳定顺序，合法性由引擎判
      let acted = false
      for (const c of sorted) {
        const r = engine.step(st, { type: 'PLAY', playerIndex: cur, cards: [c] })
        if (r.events.some((e) => e.type === 'REJECTED')) continue
        st = r.state
        if (r.events.some((e) => e.type === 'GAME_OVER')) over = true
        acted = true
        break
      }
      if (!acted) st = engine.step(st, { type: 'PASS', playerIndex: cur }).state
    }

    expect(over).toBe(true)
    expect(engine.isFinished(st)).toBe(true)

    const ranking = engine.ranking(st)
    expect(ranking).toHaveLength(3)
    expect(ranking[0]!.rank).toBe(1)
    // 每条都有 playerId 和 score
    for (const r of ranking) {
      expect(typeof r.playerId).toBe('string')
      expect(typeof r.score).toBe('number')
    }
  })
})
