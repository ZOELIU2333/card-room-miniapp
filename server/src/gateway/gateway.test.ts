import { describe, it, expect } from 'vitest'
import { WsGateway } from './gateway'
import { FakeSocket } from './socket'
import { StubAuthenticator } from './auth'
import { RoomManager } from '../room/manager'
import { PaodekuaiEngine } from '../engine/paodekuai/engine'
import { InMemorySnapshotStore } from '../room/snapshot'
import { realScheduler } from '../room/timer'
import type { ServerMessage } from '../room/transport'

function seededRandom(seed: number): () => number {
  let s = seed >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0xffffffff }
}

function makeGateway() {
  const store = new InMemorySnapshotStore()
  const gateway = new WsGateway({ authenticator: new StubAuthenticator() })
  const manager = new RoomManager({
    engine: new PaodekuaiEngine(),
    transport: gateway, // gateway 实现 Transport
    store,
    scheduler: realScheduler,
    capacity: 3,
    turnMs: 30000,
    rngFor: () => seededRandom(123),
  })
  gateway.attachRoomManager(manager)
  return { gateway, manager }
}

function lastMsg(s: FakeSocket, type: string): ServerMessage | undefined {
  const parsed = s.sent.map((t) => JSON.parse(t) as ServerMessage).filter((m) => m.type === type)
  return parsed[parsed.length - 1]
}

describe('WsGateway routing', () => {
  it('rejects non-AUTH before authentication', async () => {
    const { gateway } = makeGateway()
    const s = new FakeSocket()
    gateway.handleConnection(s)
    s.receive(JSON.stringify({ type: 'JOIN', payload: { roomId: 'r1' } }))
    await gateway.idle()
    const rej = lastMsg(s, 'REJECTED')
    expect((rej?.payload as { reason: string }).reason).toBe('NOT_AUTHED')
  })

  it('AUTH then CREATE puts the player in a room', async () => {
    const { gateway } = makeGateway()
    const s = new FakeSocket()
    gateway.handleConnection(s)
    s.receive(JSON.stringify({ type: 'AUTH', payload: { code: 'p1' } }))
    s.receive(JSON.stringify({ type: 'CREATE', payload: { roomId: 'r1' } }))
    await gateway.idle()
    expect(lastMsg(s, 'REJECTED')).toBeUndefined()
  })

  it('three players AUTH+JOIN start a game; each gets a private STATE', async () => {
    const { gateway } = makeGateway()
    const socks: FakeSocket[] = []
    for (const id of ['p1','p2','p3']) {
      const s = new FakeSocket(); socks.push(s)
      gateway.handleConnection(s)
      s.receive(JSON.stringify({ type: 'AUTH', payload: { code: id } }))
      s.receive(JSON.stringify({ type: id === 'p1' ? 'CREATE' : 'JOIN', payload: { roomId: 'r1' } }))
      await gateway.idle()
    }
    for (const s of socks) {
      const state = lastMsg(s, 'STATE')
      expect(state).toBeDefined()
      const view = state!.payload as { you: { hand: unknown[] } }
      expect(view.you.hand.length).toBe(16)
    }
  })

  it('rejects PLAY before joining a room', async () => {
    const { gateway } = makeGateway()
    const s = new FakeSocket()
    gateway.handleConnection(s)
    s.receive(JSON.stringify({ type: 'AUTH', payload: { code: 'p1' } }))
    s.receive(JSON.stringify({ type: 'PLAY', payload: { cards: [{ rank: '3', suit: 'D' }] } }))
    await gateway.idle()
    expect((lastMsg(s, 'REJECTED')?.payload as { reason: string }).reason).toBe('NOT_IN_ROOM')
  })

  it('reconnect: same playerId AUTH+RESUME re-pushes current state to new socket', async () => {
    const { gateway } = makeGateway()
    const socks: Record<string, FakeSocket> = {}
    for (const id of ['p1','p2','p3']) {
      const s = new FakeSocket(); socks[id] = s
      gateway.handleConnection(s)
      s.receive(JSON.stringify({ type: 'AUTH', payload: { code: id } }))
      s.receive(JSON.stringify({ type: id === 'p1' ? 'CREATE' : 'JOIN', payload: { roomId: 'r1' } }))
      await gateway.idle()
    }
    socks['p1']!.close()
    const s2 = new FakeSocket()
    gateway.handleConnection(s2)
    s2.receive(JSON.stringify({ type: 'AUTH', payload: { code: 'p1' } }))
    s2.receive(JSON.stringify({ type: 'RESUME', payload: {} }))
    await gateway.idle()
    const state = lastMsg(s2, 'STATE')
    expect(state).toBeDefined()
    expect((state!.payload as { you: { hand: unknown[] } }).you.hand.length).toBe(16)
  })

  it('bad message yields BAD_MESSAGE and does not crash', async () => {
    const { gateway } = makeGateway()
    const s = new FakeSocket()
    gateway.handleConnection(s)
    s.receive('garbage{')
    await gateway.idle()
    expect((lastMsg(s, 'REJECTED')?.payload as { reason: string }).reason).toBe('BAD_MESSAGE')
  })

  it('a rejected JOIN (room full) does not make the player a member and blocks PLAY', async () => {
    const { gateway } = makeGateway()
    // fill the 3-capacity room
    for (const id of ['p1','p2','p3']) {
      const s = new FakeSocket()
      gateway.handleConnection(s)
      s.receive(JSON.stringify({ type: 'AUTH', payload: { code: id } }))
      s.receive(JSON.stringify({ type: id === 'p1' ? 'CREATE' : 'JOIN', payload: { roomId: 'r1' } }))
      await gateway.idle()
    }
    // 4th player tries to join the now-started/full room
    const s4 = new FakeSocket()
    gateway.handleConnection(s4)
    s4.receive(JSON.stringify({ type: 'AUTH', payload: { code: 'p4' } }))
    s4.receive(JSON.stringify({ type: 'JOIN', payload: { roomId: 'r1' } }))
    await gateway.idle()
    // p4's join is rejected
    const rej = lastMsg(s4, 'REJECTED')
    expect(rej).toBeDefined()
    expect(['ROOM_FULL','ALREADY_STARTED']).toContain((rej!.payload as { reason: string }).reason)
    // p4 must not be seated: a subsequent PLAY is NOT_IN_ROOM, proving the rejected join
    // did not commit membership (and thus p4 receives no room broadcasts).
    s4.receive(JSON.stringify({ type: 'PLAY', payload: { cards: [{ rank: '3', suit: 'D' }] } }))
    await gateway.idle()
    expect((lastMsg(s4, 'REJECTED')!.payload as { reason: string }).reason).toBe('NOT_IN_ROOM')
  })

  it('CREATE with variant classic15 opens a 15-card room', async () => {
    const { gateway } = makeGateway()
    const socks: FakeSocket[] = []
    for (const id of ['p1','p2','p3']) {
      const s = new FakeSocket(); socks.push(s)
      gateway.handleConnection(s)
      s.receive(JSON.stringify({ type: 'AUTH', payload: { code: id } }))
      const arm = id === 'p1'
        ? { type: 'CREATE', payload: { roomId: 'r15', variant: 'classic15' } }
        : { type: 'JOIN', payload: { roomId: 'r15' } }
      s.receive(JSON.stringify(arm))
      await gateway.idle()
    }
    for (const s of socks) {
      const state = lastMsg(s, 'STATE')
      expect(state).toBeDefined()
      const view = state!.payload as { you: { hand: unknown[] } }
      expect(view.you.hand.length).toBe(15)
    }
  })

  it('JOIN to a non-existent room is REJECTED with ROOM_NOT_FOUND and does not create the room', async () => {
    const { gateway, manager } = makeGateway()
    const s = new FakeSocket()
    gateway.handleConnection(s)
    s.receive(JSON.stringify({ type: 'AUTH', payload: { code: 'p1' } }))
    s.receive(JSON.stringify({ type: 'JOIN', payload: { roomId: 'ghost' } }))
    await gateway.idle()
    const rej = lastMsg(s, 'REJECTED')
    expect(rej).toBeDefined()
    expect((rej!.payload as { reason: string }).reason).toBe('ROOM_NOT_FOUND')
    expect(manager.getRoom('ghost')).toBeUndefined()
  })

  it('a pong on a connection is handled without error when no heartbeat is attached', async () => {
    const { gateway } = makeGateway()
    const s = new FakeSocket()
    gateway.handleConnection(s)
    s.simulatePong() // pong handler registered; safe no-op when no heartbeat attached
    expect(true).toBe(true)
  })
})

describe('WsGateway.stopHeartbeat', () => {
  it('clears the heartbeat timer', () => {
    const gw = new WsGateway({ authenticator: new StubAuthenticator() })
    let cleared = false
    const scheduler = {
      set: (_cb: () => void, _ms: number) => 1,
      clear: (_id: number) => { cleared = true },
    }
    gw.startHeartbeat(scheduler, 1000)
    gw.stopHeartbeat()
    expect(cleared).toBe(true)
  })

  it('is a no-op when no heartbeat started', () => {
    const gw = new WsGateway({ authenticator: new StubAuthenticator() })
    expect(() => gw.stopHeartbeat()).not.toThrow()
  })
})
