// 身份认证接口：code → playerId。gateway 依赖此接口，认证策略可换。
export interface Authenticator {
  authenticate(code: string): Promise<string>
}

// 本地联调 / 无微信密钥环境：code 直接当 playerId。
export class StubAuthenticator implements Authenticator {
  async authenticate(code: string): Promise<string> {
    if (!code) throw new Error('empty code')
    return code
  }
}

// 注入式 fetch，便于 mock 测试（不直接依赖全局 fetch）。
export type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>

export interface WechatConfig {
  appid: string
  secret: string
}

interface JsCodeSessionResp {
  openid?: string
  session_key?: string
  errcode?: number
  errmsg?: string
}

// 真 code2session：code → openid 作 playerId。真连微信留到有密钥环境验证。
export class WechatAuthenticator implements Authenticator {
  constructor(
    private readonly config: WechatConfig,
    private readonly fetchFn: FetchLike,
  ) {}

  async authenticate(code: string): Promise<string> {
    if (!code) throw new Error('empty code')
    const url =
      `https://api.weixin.qq.com/sns/jscode2session` +
      `?appid=${encodeURIComponent(this.config.appid)}` +
      `&secret=${encodeURIComponent(this.config.secret)}` +
      `&js_code=${encodeURIComponent(code)}` +
      `&grant_type=authorization_code`
    const res = await this.fetchFn(url)
    if (!res.ok) throw new Error(`wechat http ${res.status}`)
    const body = (await res.json()) as JsCodeSessionResp
    if (body.errcode && body.errcode !== 0) {
      throw new Error(`wechat errcode ${body.errcode}: ${body.errmsg ?? ''}`)
    }
    if (!body.openid) throw new Error('wechat response missing openid')
    return body.openid
  }
}
