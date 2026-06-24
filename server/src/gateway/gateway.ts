import type { Transport, ServerMessage } from '../room/transport'
import type { RoomManager } from '../room/manager'
import type { Authenticator } from './auth'
import type { Socket } from './socket'
import { ConnectionRegistry } from './registry'
import { Heartbeat } from './heartbeat'
import { parseClientMessage, type ClientMessage } from './protocol'

type ConnState = 'CONNECTED' | 'AUTHED' | 'IN_ROOM'

interface ConnInfo {
  state: ConnState
}

export interface WsGatewayDeps {
  authenticator: Authenticator
}

// gateway 实现 room 的 Transport：把 send/broadcast/kick 落到 ws 连接上。
export class WsGateway implements Transport {
  private readonly registry = new ConnectionRegistry()
  private readonly conns = new Map<number, ConnInfo>()
  private manager: RoomManager | null = null
  private heartbeat: Heartbeat | null = null
  // 串行化异步处理（认证/入房是 async），保证 idle() 能等齐——测试用。
  private pending: Promise<void> = Promise.resolve()

  constructor(private readonly deps: WsGatewayDeps) {}

  attachRoomManager(manager: RoomManager): void {
    this.manager = manager
  }

  attachHeartbeat(hb: Heartbeat): void {
    this.heartbeat = hb
  }

  // 用自己持有的 registry 构造并启动 Heartbeat，避免对外暴露私有 registry。
  startHeartbeat(scheduler: import('../room/timer').TimerScheduler, intervalMs: number): Heartbeat {
    const hb = new Heartbeat(this.registry, scheduler, intervalMs, () => { /* onDead: registry already cleaned by Heartbeat.tick */ })
    this.heartbeat = hb
    hb.start()
    return hb
  }

  stopHeartbeat(): void {
    this.heartbeat?.stop()
    this.heartbeat = null
  }

  async idle(): Promise<void> {
    await this.pending
  }

  handleConnection(socket: Socket): void {
    const connId = this.registry.add(socket)
    this.conns.set(connId, { state: 'CONNECTED' })
    socket.on('message', (data) => { this.pending = this.pending.then(() => this.onMessage(connId, data)) })
    socket.on('close', () => this.onClose(connId))
    socket.on('pong', () => this.heartbeat?.onPong(connId))
  }

  private async onMessage(connId: number, raw: string): Promise<void> {
    const socket = this.registry.socketOf(connId)
    if (!socket) return
    const parsed = parseClientMessage(raw)
    if (!parsed.ok) return this.sendTo(socket, this.reject(parsed.reason))
    await this.route(connId, socket, parsed.msg)
  }

  private async route(connId: number, socket: Socket, msg: ClientMessage): Promise<void> {
    const info = this.conns.get(connId)!
    if (msg.type === 'AUTH') {
      try {
        const playerId = await this.deps.authenticator.authenticate(msg.code)
        const evicted = this.registry.authConnection(connId, playerId)
        if (evicted !== null) this.registry.socketOf(evicted)?.close()
        info.state = 'AUTHED'
        this.sendTo(socket, { type: 'AUTHED', payload: { playerId } })
      } catch {
        this.sendTo(socket, this.reject('AUTH_FAILED'))
      }
      return
    }

    if (info.state === 'CONNECTED') return this.sendTo(socket, this.reject('NOT_AUTHED'))
    const playerId = this.registry.playerOf(connId)!

    switch (msg.type) {
      case 'CREATE': {
        const room = this.manager!.getRoom(msg.roomId) ?? this.manager!.createRoom(msg.roomId, msg.variant)
        await this.seatPlayer(socket, info, playerId, msg.roomId, room)
        return
      }
      case 'JOIN': {
        const room = this.manager!.getRoom(msg.roomId)
        if (!room) return this.sendTo(socket, this.reject('ROOM_NOT_FOUND'))
        await this.seatPlayer(socket, info, playerId, msg.roomId, room)
        return
      }
      case 'PLAY':
      case 'PASS': {
        if (info.state !== 'IN_ROOM') return this.sendTo(socket, this.reject('NOT_IN_ROOM'))
        const roomId = this.registry.roomOfPlayer(playerId)
        const room = roomId ? this.manager!.getRoom(roomId) : undefined
        if (!room) return this.sendTo(socket, this.reject('NOT_IN_ROOM'))
        room.enqueue(msg.type === 'PLAY' ? { type: 'PLAY', playerId, cards: msg.cards } : { type: 'PASS', playerId })
        await room.idle()
        return
      }
      case 'RESUME': {
        const roomId = this.registry.roomOfPlayer(playerId)
        if (!roomId) return this.sendTo(socket, this.reject('NOT_IN_ROOM'))
        const existing = this.manager!.getRoom(roomId)
        const room = existing ?? (await this.manager!.restoreRoom(roomId)) ?? null
        if (!room) return this.sendTo(socket, this.reject('NOT_IN_ROOM'))
        info.state = 'IN_ROOM'
        room.resyncTo(playerId)
        return
      }
    }
  }

  // CREATE/JOIN 拿到 room 后的共用逻辑：准入校验、登记、入队 JOIN。
  private async seatPlayer(socket: Socket, info: ConnInfo, playerId: string, roomId: string, room: import('../room/room').Room): Promise<void> {
    const verdict = room.canJoin(playerId)
    if (!verdict.ok) return this.sendTo(socket, this.reject(verdict.reason))
    this.registry.joinRoom(playerId, roomId)
    info.state = 'IN_ROOM'
    room.enqueue({ type: 'JOIN', playerId })
    await room.idle()
  }

  private onClose(connId: number): void {
    this.conns.delete(connId)
    this.registry.removeConnection(connId)
    // 不通知 room 退出：room 靠超时代打兜底；playerId→roomId 保留供重连。
  }

  // ---- Transport 实现 ----
  send(playerId: string, msg: ServerMessage): void {
    const socket = this.registry.socketOfPlayer(playerId)
    if (socket) this.sendTo(socket, msg)
  }

  broadcast(roomId: string, msg: ServerMessage): void {
    for (const playerId of this.registry.membersOf(roomId)) {
      const socket = this.registry.socketOfPlayer(playerId)
      if (socket) this.sendTo(socket, msg) // 死连接查不到 socket，静默跳过
    }
  }

  kick(playerId: string): void {
    this.registry.socketOfPlayer(playerId)?.close()
  }

  private sendTo(socket: Socket, msg: ServerMessage): void {
    socket.send(JSON.stringify(msg))
  }

  private reject(reason: string): ServerMessage {
    return { type: 'REJECTED', payload: { reason } }
  }
}
