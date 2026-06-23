import { describe, it, expect } from 'vitest'
import { ConnectionRegistry } from './registry'
import { FakeSocket } from './socket'

describe('ConnectionRegistry', () => {
  it('binds a connection and finds its socket', () => {
    const reg = new ConnectionRegistry()
    const s = new FakeSocket()
    const connId = reg.add(s)
    expect(reg.socketOf(connId)).toBe(s)
  })

  it('auth maps playerId to connId; socketOfPlayer resolves', () => {
    const reg = new ConnectionRegistry()
    const s = new FakeSocket()
    const connId = reg.add(s)
    reg.authConnection(connId, 'p1')
    expect(reg.socketOfPlayer('p1')).toBe(s)
  })

  it('re-auth of same player on a new connection evicts the old connId', () => {
    const reg = new ConnectionRegistry()
    const s1 = new FakeSocket(); const c1 = reg.add(s1)
    reg.authConnection(c1, 'p1')
    const s2 = new FakeSocket(); const c2 = reg.add(s2)
    const evicted = reg.authConnection(c2, 'p1')
    expect(evicted).toBe(c1)
    expect(reg.socketOfPlayer('p1')).toBe(s2)
  })

  it('tracks player room membership and lists members', () => {
    const reg = new ConnectionRegistry()
    const a = reg.add(new FakeSocket()); reg.authConnection(a, 'p1'); reg.joinRoom('p1', 'r1')
    const b = reg.add(new FakeSocket()); reg.authConnection(b, 'p2'); reg.joinRoom('p2', 'r1')
    expect(reg.membersOf('r1').sort()).toEqual(['p1', 'p2'])
    expect(reg.roomOfPlayer('p1')).toBe('r1')
  })

  it('removing a connection clears socket+player maps but keeps room membership', () => {
    const reg = new ConnectionRegistry()
    const c = reg.add(new FakeSocket()); reg.authConnection(c, 'p1'); reg.joinRoom('p1', 'r1')
    reg.removeConnection(c)
    expect(reg.socketOf(c)).toBeUndefined()
    expect(reg.socketOfPlayer('p1')).toBeUndefined()
    expect(reg.roomOfPlayer('p1')).toBe('r1') // 保留供重连
  })

  it('playerOf returns the player bound to a connId', () => {
    const reg = new ConnectionRegistry()
    const c = reg.add(new FakeSocket()); reg.authConnection(c, 'p1')
    expect(reg.playerOf(c)).toBe('p1')
  })

  it('evicted connection socket is still retrievable so caller can close it', () => {
    const reg = new ConnectionRegistry()
    const s1 = new FakeSocket(); const c1 = reg.add(s1)
    reg.authConnection(c1, 'p1')
    const s2 = new FakeSocket(); const c2 = reg.add(s2)
    const evicted = reg.authConnection(c2, 'p1')
    expect(evicted).toBe(c1)
    // 调用方要能拿到被顶掉的旧 socket 去关它（修复前这里是 undefined）
    expect(reg.socketOf(evicted!)).toBe(s1)
  })
})
