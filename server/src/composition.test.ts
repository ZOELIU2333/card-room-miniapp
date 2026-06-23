import { describe, it, expect } from 'vitest'
import { createServer, type WssLike } from './composition'
import type { Config } from './config'
import { WechatAuthenticator, StubAuthenticator, FakeSocket } from './gateway'

function fakeWssFactory() {
  const calls = { close: 0 }
  let onConnection: ((ws: unknown) => void) | undefined
  const factory = (_port: number): WssLike => ({
    on: (event, handler) => { if (event === 'connection') onConnection = handler as (ws: unknown) => void },
    close: () => { calls.close++ },
    clients: new Set(),
  })
  return { factory, calls, getOnConnection: () => onConnection }
}

const baseConfig: Config = { port: 8080, heartbeatMs: 1000, turnMs: 1000, capacity: 3, wx: null }

describe('createServer', () => {
  it('selects StubAuthenticator when wx is null', () => {
    const { factory } = fakeWssFactory()
    const server = createServer(baseConfig, { wssFactory: factory })
    expect(server.authenticator).toBeInstanceOf(StubAuthenticator)
  })

  it('selects WechatAuthenticator when wx is set', () => {
    const { factory } = fakeWssFactory()
    const server = createServer(
      { ...baseConfig, wx: { appid: 'a', secret: 's' } },
      { wssFactory: factory },
    )
    expect(server.authenticator).toBeInstanceOf(WechatAuthenticator)
  })

  it('attaches the RoomManager to the gateway (no this.manager! crash on JOIN)', async () => {
    const { factory } = fakeWssFactory()
    const server = createServer(baseConfig, { wssFactory: factory })
    const s = new FakeSocket()
    server.gateway.handleConnection(s)
    s.receive(JSON.stringify({ type: 'AUTH', payload: { code: 'p1' } }))
    s.receive(JSON.stringify({ type: 'CREATE', payload: { roomId: 'r1' } }))
    await server.gateway.idle()
    expect(server.manager.getRoom('r1')).toBeDefined()
  })

  it('shutdown stops heartbeat, closes wss, and is idempotent', async () => {
    const { factory, calls } = fakeWssFactory()
    const server = createServer(baseConfig, { wssFactory: factory })
    await server.shutdown()
    await server.shutdown()
    expect(calls.close).toBe(1)
  })
})
