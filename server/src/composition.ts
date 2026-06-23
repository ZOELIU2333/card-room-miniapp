import { WebSocketServer, type WebSocket } from 'ws'
import type { Socket } from './gateway/socket'
import type { Config } from './config'
import type { Authenticator } from './gateway'
import type { RoomManager as RoomManagerType } from './room'
import type { WsGateway as WsGatewayType } from './gateway'
import { WsGateway, StubAuthenticator, WechatAuthenticator } from './gateway'
import { RoomManager, InMemorySnapshotStore, realScheduler } from './room'
import { PaodekuaiEngine } from './engine/paodekuai'

export interface WssLike {
  on(event: 'connection', handler: (ws: unknown) => void): void
  close(): void
  clients: Set<{ close(): void }>
}

export type WssFactory = (port: number) => WssLike

export interface RunningServer {
  gateway: WsGatewayType
  manager: RoomManagerType
  authenticator: Authenticator
  wss: WssLike
  shutdown: () => Promise<void>
}

const intervalScheduler = {
  set: (cb: () => void, ms: number) => setInterval(cb, ms) as unknown as number,
  clear: (id: number) => clearInterval(id),
}

// 把真 ws.WebSocket 包成 gateway 的 Socket 抽象（薄 adapter）；ws 的事件签名与 Socket 不同，这里做形参收敛。
function wrap(ws: WebSocket): Socket {
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

function defaultWssFactory(port: number): WssLike {
  return new WebSocketServer({ port }) as unknown as WssLike
}

export function createServer(
  config: Config,
  opts?: { wssFactory?: WssFactory },
): RunningServer {
  const authenticator: Authenticator = config.wx
    ? new WechatAuthenticator(config.wx, globalThis.fetch as never)
    : new StubAuthenticator()

  const gateway = new WsGateway({ authenticator })

  const manager = new RoomManager({
    engine: new PaodekuaiEngine(),
    transport: gateway,
    store: new InMemorySnapshotStore(),
    scheduler: realScheduler,
    capacity: config.capacity,
    turnMs: config.turnMs,
    rngFor: () => Math.random,
  })

  gateway.attachRoomManager(manager)

  const factory = opts?.wssFactory ?? defaultWssFactory
  const wss = factory(config.port)
  wss.on('connection', (ws) => gateway.handleConnection(wrap(ws as WebSocket)))

  gateway.startHeartbeat(intervalScheduler, config.heartbeatMs)

  let stopped = false
  const shutdown = async (): Promise<void> => {
    if (stopped) return
    stopped = true
    gateway.stopHeartbeat()
    wss.close()
    for (const client of wss.clients) client.close()
  }

  return { gateway, manager, authenticator, wss, shutdown }
}
