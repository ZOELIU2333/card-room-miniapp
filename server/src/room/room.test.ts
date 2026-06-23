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
