import { describe, it, expect } from 'vitest'
import { loadConfig } from './config'

describe('loadConfig', () => {
  it('applies defaults when env is empty', () => {
    const c = loadConfig({})
    expect(c.port).toBe(8080)
    expect(c.heartbeatMs).toBe(30000)
    expect(c.turnMs).toBe(30000)
    expect(c.capacity).toBe(3)
    expect(c.wx).toBeNull()
  })

  it('reads overrides from env', () => {
    const c = loadConfig({ PORT: '9000', HEARTBEAT_MS: '5000', TURN_MS: '20000', ROOM_CAPACITY: '4' })
    expect(c.port).toBe(9000)
    expect(c.heartbeatMs).toBe(5000)
    expect(c.turnMs).toBe(20000)
    expect(c.capacity).toBe(4)
  })

  it('enables wechat auth only when both appid and secret present', () => {
    expect(loadConfig({ WX_APPID: 'a', WX_SECRET: 's' }).wx).toEqual({ appid: 'a', secret: 's' })
    expect(loadConfig({ WX_APPID: 'a' }).wx).toBeNull()
    expect(loadConfig({ WX_SECRET: 's' }).wx).toBeNull()
  })

  it('throws on non-numeric numeric env', () => {
    expect(() => loadConfig({ PORT: 'abc' })).toThrow()
  })

  it('throws on non-positive numeric env', () => {
    expect(() => loadConfig({ TURN_MS: '0' })).toThrow()
    expect(() => loadConfig({ ROOM_CAPACITY: '-1' })).toThrow()
  })
})
