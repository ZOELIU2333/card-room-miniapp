// gateway 核心只依赖这个最小连接抽象，不依赖具体的 ws.WebSocket。
// 真 ws 在 createGateway 里用薄 adapter 包成 Socket；测试用 FakeSocket。
export type SocketEvent = 'message' | 'close' | 'pong'

export interface Socket {
  send(data: string): void
  close(): void
  terminate(): void
  ping(): void
  on(event: 'message', handler: (data: string) => void): void
  on(event: 'close', handler: () => void): void
  on(event: 'pong', handler: () => void): void
}

// 测试替身：录制发送、手动触发收消息/pong/close。
export class FakeSocket implements Socket {
  readonly sent: string[] = []
  readonly pings: number[] = []
  closed = false
  private handlers: { message: Array<(d: string) => void>; close: Array<() => void>; pong: Array<() => void> } = {
    message: [], close: [], pong: [],
  }

  send(data: string): void { this.sent.push(data) }
  ping(): void { this.pings.push(1) }

  close(): void {
    if (this.closed) return
    this.closed = true
    for (const h of this.handlers.close) h()
  }

  terminate(): void { this.close() }

  on(event: SocketEvent, handler: (...args: never[]) => void): void {
    if (event === 'message') this.handlers.message.push(handler as (d: string) => void)
    else if (event === 'close') this.handlers.close.push(handler as () => void)
    else this.handlers.pong.push(handler as () => void)
  }

  // 测试驱动用：
  receive(data: string): void { for (const h of this.handlers.message) h(data) }
  simulatePong(): void { for (const h of this.handlers.pong) h() }
}
