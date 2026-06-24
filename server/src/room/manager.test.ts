import { describe, it, expect } from 'vitest'
import { RoomManager } from './manager'
import { PaodekuaiEngine } from '../engine/paodekuai/engine'
import { RecordingTransport } from './transport'
import { InMemorySnapshotStore } from './snapshot'
import { realScheduler } from './timer'

function seededRandom(seed: number): () => number {
  let s = seed >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0xffffffff }
}

function makeManager(store = new InMemorySnapshotStore()) {
  const transport = new RecordingTransport()
  const mgr = new RoomManager({
    engine: new PaodekuaiEngine(),
    transport,
    store,
    scheduler: realScheduler,
    capacity: 3,
    turnMs: 30000,
    rngFor: () => seededRandom(123),
  })
  return { mgr, transport, store }
}

function lastHand(transport: RecordingTransport, playerId: string): unknown[] {
  const state = transport.sentTo(playerId).filter((m) => m.type === 'STATE').at(-1)
  return (state!.payload as { you: { hand: unknown[] } }).you.hand
}

describe('RoomManager', () => {
  it('creates and finds a room by id', () => {
    const { mgr } = makeManager()
    const room = mgr.createRoom('r1')
    expect(mgr.getRoom('r1')).toBe(room)
  })

  it('rejects creating a room id that already exists', () => {
    const { mgr } = makeManager()
    mgr.createRoom('r1')
    expect(() => mgr.createRoom('r1')).toThrow()
  })

  it('createRoom defaults to classic16 (16 cards dealt)', async () => {
    const { mgr, transport } = makeManager()
    const room = mgr.createRoom('r1')
    for (const id of ['p1', 'p2', 'p3']) room.enqueue({ type: 'JOIN', playerId: id })
    await room.idle()
    const hand = lastHand(transport, 'p1')
    expect(hand).toHaveLength(16)
  })

  it('createRoom with classic15 deals 15 cards', async () => {
    const { mgr, transport } = makeManager()
    const room = mgr.createRoom('r1', 'classic15')
    for (const id of ['p1', 'p2', 'p3']) room.enqueue({ type: 'JOIN', playerId: id })
    await room.idle()
    const hand = lastHand(transport, 'p1')
    expect(hand).toHaveLength(15)
  })

  it('destroyRoom removes it', () => {
    const { mgr } = makeManager()
    mgr.createRoom('r1')
    mgr.destroyRoom('r1')
    expect(mgr.getRoom('r1')).toBeUndefined()
  })

  it('restores a room from snapshot with matching state', async () => {
    const store = new InMemorySnapshotStore()
    const { mgr } = makeManager(store)
    const room = mgr.createRoom('r1')
    for (const id of ['p1','p2','p3']) room.enqueue({ type: 'JOIN', playerId: id })
    await room.idle()
    const turnBefore = room.currentTurn()
    const currentBefore = room.currentPlayerId()

    // 模拟进程重启：销毁内存中的房间，从快照重建
    mgr.destroyRoom('r1')
    expect(mgr.getRoom('r1')).toBeUndefined()
    const restored = await mgr.restoreRoom('r1')
    expect(restored).not.toBeNull()
    expect(restored!.currentTurn()).toBe(turnBefore)
    expect(restored!.currentPlayerId()).toBe(currentBefore)
    expect(restored!.phase).toBe('PLAYING')
  })

  it('restoreRoom returns null when no snapshot exists', async () => {
    const { mgr } = makeManager()
    expect(await mgr.restoreRoom('ghost')).toBeNull()
  })
})
