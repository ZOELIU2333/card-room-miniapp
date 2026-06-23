// room 广播给客户端的消息。payload 形状由各消息类型定义，
// 序列化由 transport 实现负责，room 只产出结构化对象。
export interface ServerMessage {
  type: string
  payload: unknown
}

// room 与网络层的接缝。gateway 实现真 WebSocket 版；测试用 RecordingTransport。
// room 永不认识 WebSocket。
export interface Transport {
  send(playerId: string, msg: ServerMessage): void
  broadcast(roomId: string, msg: ServerMessage): void
  kick(playerId: string): void
}

// 测试替身：录制所有调用，供断言。
export class RecordingTransport implements Transport {
  private broadcasts = new Map<string, ServerMessage[]>()
  private sends = new Map<string, ServerMessage[]>()
  readonly kicked: string[] = []

  send(playerId: string, msg: ServerMessage): void {
    const list = this.sends.get(playerId) ?? []
    list.push(msg)
    this.sends.set(playerId, list)
  }

  broadcast(roomId: string, msg: ServerMessage): void {
    const list = this.broadcasts.get(roomId) ?? []
    list.push(msg)
    this.broadcasts.set(roomId, list)
  }

  kick(playerId: string): void {
    this.kicked.push(playerId)
  }

  broadcastsTo(roomId: string): ServerMessage[] {
    return this.broadcasts.get(roomId) ?? []
  }

  sentTo(playerId: string): ServerMessage[] {
    return this.sends.get(playerId) ?? []
  }
}
