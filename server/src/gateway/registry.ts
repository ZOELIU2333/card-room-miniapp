import type { Socket } from './socket'

// gateway 的三组映射：
//  connId → socket           物理连接
//  playerId → connId         当前活跃连接（重连顶号）
//  playerId → roomId         所在房间（断线保留，供重连接回）
// connId↔playerId 也反向存一份，便于按连接查玩家。
export class ConnectionRegistry {
  private nextId = 1
  private sockets = new Map<number, Socket>()
  private connToPlayer = new Map<number, string>()
  private playerToConn = new Map<string, number>()
  private playerToRoom = new Map<string, string>()

  add(socket: Socket): number {
    const id = this.nextId++
    this.sockets.set(id, socket)
    return id
  }

  socketOf(connId: number): Socket | undefined {
    return this.sockets.get(connId)
  }

  playerOf(connId: number): string | undefined {
    return this.connToPlayer.get(connId)
  }

  // 绑定连接到玩家。若该玩家已有旧连接，返回被顶掉的旧 connId（调用方负责关它）。
  authConnection(connId: number, playerId: string): number | null {
    const prev = this.playerToConn.get(playerId) ?? null
    if (prev !== null && prev !== connId) {
      this.connToPlayer.delete(prev)
      // 不删 socket：返回 prev 让调用方关闭它（关闭触发 close → removeConnection 清理 socket map）。
    }
    this.connToPlayer.set(connId, playerId)
    this.playerToConn.set(playerId, connId)
    return prev !== null && prev !== connId ? prev : null
  }

  socketOfPlayer(playerId: string): Socket | undefined {
    const connId = this.playerToConn.get(playerId)
    return connId === undefined ? undefined : this.sockets.get(connId)
  }

  joinRoom(playerId: string, roomId: string): void {
    this.playerToRoom.set(playerId, roomId)
  }

  roomOfPlayer(playerId: string): string | undefined {
    return this.playerToRoom.get(playerId)
  }

  membersOf(roomId: string): string[] {
    const out: string[] = []
    for (const [playerId, rid] of this.playerToRoom) if (rid === roomId) out.push(playerId)
    return out
  }

  // 物理连接断开：清 socket 与 playerId↔connId，保留 playerId→roomId 供重连。
  removeConnection(connId: number): void {
    const playerId = this.connToPlayer.get(connId)
    this.sockets.delete(connId)
    this.connToPlayer.delete(connId)
    if (playerId !== undefined && this.playerToConn.get(playerId) === connId) {
      this.playerToConn.delete(playerId)
    }
  }

  allConnIds(): number[] {
    return [...this.sockets.keys()]
  }
}
