import type { Card } from '../engine/paodekuai/card'

// 进入房间的命令。玩家意图、成员变更、计时器到期统一成命令走串行队列。
export type Command =
  | { type: 'PLAY'; playerId: string; cards: Card[] }
  | { type: 'PASS'; playerId: string }
  | { type: 'JOIN'; playerId: string }
  | { type: 'LEAVE'; playerId: string }
  | { type: 'TIMEOUT'; turn: number } // 计时器到期，带起设时的回合号

export type CommandHandler = (cmd: Command) => Promise<void>

// 单房间串行队列：前一个 handler 完成才处理下一个，杜绝并发改状态。
// 房间之间天然并行（各自一个队列）。
export class CommandQueue {
  private queue: Command[] = []
  private running = false
  private idleResolvers: Array<() => void> = []

  constructor(private readonly handler: CommandHandler) {}

  enqueue(cmd: Command): void {
    this.queue.push(cmd)
    if (!this.running) void this.run()
  }

  // 等待队列清空（测试与优雅关闭用）。
  drain(): Promise<void> {
    if (!this.running && this.queue.length === 0) return Promise.resolve()
    return new Promise((resolve) => this.idleResolvers.push(resolve))
  }

  private async run(): Promise<void> {
    this.running = true
    try {
      while (this.queue.length > 0) {
        const cmd = this.queue.shift()!
        try {
          await this.handler(cmd)
        } catch {
          // 单条命令处理失败不应拖垮整个房间队列；吞掉继续下一条。
          // Room 的 handler 设计上不抛（拒绝走事件、快照失败内部 catch），
          // 这里是防御性兜底，保证队列永不死锁。
        }
      }
    } finally {
      this.running = false
      const resolvers = this.idleResolvers
      this.idleResolvers = []
      for (const r of resolvers) r()
    }
  }
}
