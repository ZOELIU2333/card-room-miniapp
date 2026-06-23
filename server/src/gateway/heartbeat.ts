import type { TimerScheduler } from '../room/timer'
import type { ConnectionRegistry } from './registry'

// 协议级 ping/pong 心跳。每个周期：先处理上一周期没回 pong 的连接（判死），
// 再对存活连接发 ping 并标记“待确认”。收到 pong 清除标记。
export class Heartbeat {
  private awaitingPong = new Set<number>()
  private timerId: number | null = null

  constructor(
    private readonly registry: ConnectionRegistry,
    private readonly scheduler: TimerScheduler,
    private readonly intervalMs: number,
    private readonly onDead: (connId: number) => void,
  ) {}

  start(): void {
    this.timerId = this.scheduler.set(() => this.tick(), this.intervalMs)
  }

  stop(): void {
    if (this.timerId !== null) { this.scheduler.clear(this.timerId); this.timerId = null }
  }

  onPong(connId: number): void {
    this.awaitingPong.delete(connId)
  }

  private tick(): void {
    for (const connId of this.registry.allConnIds()) {
      if (this.awaitingPong.has(connId)) {
        // 上一轮 ping 没回 → 判死
        const socket = this.registry.socketOf(connId)
        socket?.terminate()
        this.awaitingPong.delete(connId)
        this.registry.removeConnection(connId)
        this.onDead(connId)
        continue
      }
      const socket = this.registry.socketOf(connId)
      if (socket) { socket.ping(); this.awaitingPong.add(connId) }
    }
  }
}
