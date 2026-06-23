// 计时器调度抽象。生产用 setTimeout/clearTimeout；测试用假时钟。
// 这样 room 不直接碰真实时间，计时逻辑可单测。
export interface TimerScheduler {
  set(cb: () => void, ms: number): number
  clear(id: number): void
}

// 生产实现：包 setTimeout。
export const realScheduler: TimerScheduler = {
  set: (cb, ms) => setTimeout(cb, ms) as unknown as number,
  clear: (id) => clearTimeout(id),
}

// 回合计时器：start(turn) 起计时，到期回调带上该 turn。
// 重新 start 或 clear 会取消上一个未触发的计时器。
export class TurnTimer {
  private activeId: number | null = null

  constructor(
    private readonly scheduler: TimerScheduler,
    private readonly ms: number,
    private readonly onTimeout: (turn: number) => void,
  ) {}

  start(turn: number): void {
    this.clear()
    this.activeId = this.scheduler.set(() => {
      this.activeId = null
      this.onTimeout(turn)
    }, this.ms)
  }

  clear(): void {
    if (this.activeId !== null) {
      this.scheduler.clear(this.activeId)
      this.activeId = null
    }
  }
}
