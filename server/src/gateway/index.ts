import type { WebSocket } from 'ws'
import type { Socket } from './socket'

export { WsGateway } from './gateway'
export type { WsGatewayDeps } from './gateway'
export { ConnectionRegistry } from './registry'
export { parseClientMessage } from './protocol'
export type { ClientMessage } from './protocol'
export { StubAuthenticator, WechatAuthenticator } from './auth'
export type { Authenticator, FetchLike, WechatConfig } from './auth'
export { Heartbeat } from './heartbeat'
export type { Socket } from './socket'
export { FakeSocket } from './socket'

// 把真 ws.WebSocket 包成 gateway 的 Socket 抽象（薄 adapter）。
export function wrap(ws: WebSocket): Socket {
  return {
    send: (data) => ws.send(data),
    close: () => ws.close(),
    terminate: () => ws.terminate(),
    ping: () => ws.ping(),
    on: (event: 'message' | 'close' | 'pong', handler: (...a: never[]) => void) => {
      if (event === 'message') ws.on('message', (d) => (handler as (s: string) => void)(d.toString()))
      else if (event === 'close') ws.on('close', () => (handler as () => void)())
      else ws.on('pong', () => (handler as () => void)())
    },
  }
}
