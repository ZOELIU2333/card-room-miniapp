import { describe, it, expect } from 'vitest'
import { StubAuthenticator, WechatAuthenticator, type FetchLike } from './auth'

describe('StubAuthenticator', () => {
  it('returns the code as the playerId', async () => {
    const auth = new StubAuthenticator()
    expect(await auth.authenticate('player-xyz')).toBe('player-xyz')
  })
  it('rejects empty code', async () => {
    const auth = new StubAuthenticator()
    await expect(auth.authenticate('')).rejects.toThrow()
  })
})

describe('WechatAuthenticator', () => {
  function fetchReturning(status: number, body: unknown): FetchLike {
    return async () => ({ ok: status >= 200 && status < 300, status, json: async () => body })
  }

  it('returns openid on success', async () => {
    const auth = new WechatAuthenticator(
      { appid: 'a', secret: 's' },
      fetchReturning(200, { openid: 'wx-openid-123' }),
    )
    expect(await auth.authenticate('code-abc')).toBe('wx-openid-123')
  })
  it('throws on wechat errcode', async () => {
    const auth = new WechatAuthenticator(
      { appid: 'a', secret: 's' },
      fetchReturning(200, { errcode: 40029, errmsg: 'invalid code' }),
    )
    await expect(auth.authenticate('bad')).rejects.toThrow(/40029/)
  })
  it('throws on network/non-2xx', async () => {
    const auth = new WechatAuthenticator(
      { appid: 'a', secret: 's' },
      fetchReturning(500, {}),
    )
    await expect(auth.authenticate('code')).rejects.toThrow()
  })
  it('calls jscode2session with appid/secret/js_code', async () => {
    let calledUrl = ''
    const auth = new WechatAuthenticator(
      { appid: 'APPID', secret: 'SECRET' },
      async (url: string) => { calledUrl = url; return { ok: true, status: 200, json: async () => ({ openid: 'o' }) } },
    )
    await auth.authenticate('CODE')
    expect(calledUrl).toContain('jscode2session')
    expect(calledUrl).toContain('appid=APPID')
    expect(calledUrl).toContain('secret=SECRET')
    expect(calledUrl).toContain('js_code=CODE')
    expect(calledUrl).toContain('grant_type=authorization_code')
  })
})
