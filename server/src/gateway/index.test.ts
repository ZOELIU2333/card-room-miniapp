import { describe, it, expect } from 'vitest'
import { WsGateway, ConnectionRegistry, parseClientMessage, StubAuthenticator, Heartbeat } from './index'

describe('gateway index exports', () => {
  it('re-exports the core building blocks', () => {
    expect(typeof WsGateway).toBe('function')
    expect(typeof ConnectionRegistry).toBe('function')
    expect(typeof parseClientMessage).toBe('function')
    expect(typeof StubAuthenticator).toBe('function')
    expect(typeof Heartbeat).toBe('function')
  })
})
