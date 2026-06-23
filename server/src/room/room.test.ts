import { describe, it, expect } from 'vitest'
import { Room } from './room'
import { PaodekuaiEngine } from '../engine/paodekuai/engine'
import { RecordingTransport, type ServerMessage } from './transport'
import { InMemorySnapshotStore } from './snapshot'
import { realScheduler } from './timer'

function seededRandom(seed: number): () => number {
  let s = seed >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0xffffffff }
}

function makeRoom(transport: RecordingTransport) {
  return new Room({
    roomId: 'r1',
    engine: new PaodekuaiEngine(),
    transport,
    store: new InMemorySnapshotStore(),
    scheduler: realScheduler,
    rng: seededRandom(123),
    capacity: 3,
    turnMs: 30000,
  })
}

function stateMsgs(t: RecordingTransport): ServerMessage[] {
  return t.broadcastsTo('r1').filter((m) => m.type === 'STATE')
}

describe('Room join and start', () => {
  it('starts the game when capacity is reached and broadcasts STATE', async () => {
    const t = new RecordingTransport()
    const room = makeRoom(t)
    room.enqueue({ type: 'JOIN', playerId: 'p1' })
    room.enqueue({ type: 'JOIN', playerId: 'p2' })
    room.enqueue({ type: 'JOIN', playerId: 'p3' })
    await room.idle()
    expect(room.phase).toBe('PLAYING')
    expect(stateMsgs(t).length).toBeGreaterThanOrEqual(1)
  })

  it('desensitizes: each player sees only their own hand', async () => {
    const t = new RecordingTransport()
    const room = makeRoom(t)
    room.enqueue({ type: 'JOIN', playerId: 'p1' })
    room.enqueue({ type: 'JOIN', playerId: 'p2' })
    room.enqueue({ type: 'JOIN', playerId: 'p3' })
    await room.idle()
    const p1msgs = t.sentTo('p1').filter((m) => m.type === 'STATE')
    expect(p1msgs.length).toBeGreaterThanOrEqual(1)
    const view = p1msgs[p1msgs.length - 1]!.payload as {
      you: { hand: unknown[] }
      others: Array<{ playerId: string; handCount: number }>
    }
    expect(view.you.hand.length).toBe(16)
    expect(view.others).toHaveLength(2)
    for (const o of view.others) {
      expect(o.handCount).toBe(16)
      expect((o as Record<string, unknown>).hand).toBeUndefined()
    }
  })

  it('rejects join beyond capacity', async () => {
    const t = new RecordingTransport()
    const room = makeRoom(t)
    for (const id of ['p1','p2','p3','p4']) room.enqueue({ type: 'JOIN', playerId: id })
    await room.idle()
    expect(t.sentTo('p4').some((m) => m.type === 'REJECTED')).toBe(true)
  })
})

describe('Room play, timeout, finish', () => {
  // 起一个已开局的房间，返回 room、transport，并给出当前该谁出牌的 playerId
  async function started() {
    const t = new RecordingTransport()
    const room = makeRoom(t)
    for (const id of ['p1','p2','p3']) room.enqueue({ type: 'JOIN', playerId: id })
    await room.idle()
    return { t, room }
  }

  it('rejects PLAY from a player who is not the current turn', async () => {
    const { t, room } = await started()
    const current = room.currentPlayerId()!
    const notCurrent = ['p1','p2','p3'].find((id) => id !== current)!
    room.enqueue({ type: 'PLAY', playerId: notCurrent, cards: [{ rank: '3', suit: 'D' }] })
    await room.idle()
    expect(t.sentTo(notCurrent).some(
      (m) => m.type === 'REJECTED'
        && (m.payload as { reason: string }).reason === 'NOT_YOUR_TURN')).toBe(true)
  })

  it('timeout triggers an autoplay move and advances the turn', async () => {
    const { room } = await started()
    const before = room.currentPlayerId()
    // 直接投递一个与当前回合号匹配的 TIMEOUT（模拟计时器到期）
    room.enqueue({ type: 'TIMEOUT', turn: room.currentTurn() })
    await room.idle()
    // 代打后回合应推进（除非这一手直接终局）
    expect(room.currentPlayerId() !== before || room.phase === 'FINISHED').toBe(true)
  })

  it('stale TIMEOUT (wrong turn number) is ignored', async () => {
    const { room } = await started()
    const before = room.currentPlayerId()
    room.enqueue({ type: 'TIMEOUT', turn: 999 }) // 过期回合号
    await room.idle()
    expect(room.currentPlayerId()).toBe(before)
    expect(room.phase).toBe('PLAYING')
  })

  it('plays a full game to completion via repeated timeouts and broadcasts GAME_OVER', async () => {
    const { t, room } = await started()
    let guard = 0
    while (room.phase === 'PLAYING' && guard < 3000) {
      guard++
      room.enqueue({ type: 'TIMEOUT', turn: room.currentTurn() })
      await room.idle()
    }
    expect(room.phase).toBe('FINISHED')
    const overMsgs = t.broadcastsTo('r1').filter((m) => m.type === 'GAME_OVER')
    expect(overMsgs).toHaveLength(1)
    const payload = overMsgs[0]!.payload as { ranking: Array<{ playerId: string; rank: number; score: number }> }
    expect(payload.ranking).toHaveLength(3)
    expect(payload.ranking[0]!.rank).toBe(1)
  })

  it('LEAVE during play is a no-op: game continues, turn unchanged', async () => {
    const { room } = await started()
    const before = room.currentPlayerId()
    const someone = ['p1','p2','p3'].find((id) => id !== before)!
    room.enqueue({ type: 'LEAVE', playerId: someone })
    await room.idle()
    expect(room.phase).toBe('PLAYING')
    expect(room.currentPlayerId()).toBe(before)
  })

  it('forwards engine reject reason to only the acting player and leaves state unchanged', async () => {
    const { t, room } = await started()
    const current = room.currentPlayerId()!
    // 当前玩家打一张几乎肯定不在手里的牌组合（两张不成对）→ 引擎拒 ILLEGAL_COMBO 或 NOT_IN_HAND
    const turnBefore = room.currentTurn()
    room.enqueue({ type: 'PLAY', playerId: current, cards: [{ rank: '3', suit: 'D' }, { rank: '7', suit: 'S' }] })
    await room.idle()
    const rejects = t.sentTo(current).filter((m) => m.type === 'REJECTED')
    expect(rejects.length).toBeGreaterThanOrEqual(1)
    // 回合未推进（被拒不改状态）
    expect(room.currentTurn()).toBe(turnBefore)
    expect(room.phase).toBe('PLAYING')
  })
})
