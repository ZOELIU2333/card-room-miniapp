import { describe, it, expect } from 'vitest'
import { TurnTimer, type TimerScheduler } from './timer'

// 假时钟：手动触发到期，不依赖真实时间。
function fakeScheduler(): TimerScheduler & { fireAll: () => void } {
  let pending: Array<{ id: number; cb: () => void }> = []
  let nextId = 1
  return {
    set(cb: () => void, _ms: number): number {
      const id = nextId++
      pending.push({ id, cb })
      return id
    },
    clear(id: number): void {
      pending = pending.filter((p) => p.id !== id)
    },
    fireAll(): void {
      const due = pending
      pending = []
      for (const p of due) p.cb()
    },
  }
}

describe('TurnTimer', () => {
  it('fires callback with the turn number it was started for', () => {
    const sched = fakeScheduler()
    const fired: number[] = []
    const timer = new TurnTimer(sched, 30000, (turn) => fired.push(turn))
    timer.start(7)
    sched.fireAll()
    expect(fired).toEqual([7])
  })

  it('clearing before fire produces no callback', () => {
    const sched = fakeScheduler()
    const fired: number[] = []
    const timer = new TurnTimer(sched, 30000, (turn) => fired.push(turn))
    timer.start(3)
    timer.clear()
    sched.fireAll()
    expect(fired).toEqual([])
  })

  it('starting a new turn clears the previous timer', () => {
    const sched = fakeScheduler()
    const fired: number[] = []
    const timer = new TurnTimer(sched, 30000, (turn) => fired.push(turn))
    timer.start(1)
    timer.start(2) // 应自动清掉 turn 1 的计时器
    sched.fireAll()
    expect(fired).toEqual([2])
  })
})
