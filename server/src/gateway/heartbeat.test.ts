import { describe, it, expect } from 'vitest'
import { Heartbeat } from './heartbeat'
import { ConnectionRegistry } from './registry'
import { FakeSocket } from './socket'
import type { TimerScheduler } from '../room/timer'

// 假周期调度：手动 tick 触发。
function fakeInterval(): TimerScheduler & { tick: () => void } {
  let cb: (() => void) | null = null
  return {
    set(fn: () => void, _ms: number): number { cb = fn; return 1 },
    clear(_id: number): void { cb = null },
    tick(): void { if (cb) cb() },
  }
}

describe('Heartbeat', () => {
  it('pings all live connections each tick', () => {
    const reg = new ConnectionRegistry()
    const s = new FakeSocket(); reg.add(s)
    const sched = fakeInterval()
    const hb = new Heartbeat(reg, sched, 30000, () => {})
    hb.start()
    sched.tick()
    expect(s.pings.length).toBe(1)
  })

  it('terminates and reports a connection that missed its pong', () => {
    const reg = new ConnectionRegistry()
    const s = new FakeSocket(); const c = reg.add(s)
    const dead: number[] = []
    const sched = fakeInterval()
    const hb = new Heartbeat(reg, sched, 30000, (connId) => dead.push(connId))
    hb.start()
    sched.tick() // 第一轮：ping，标记待确认
    sched.tick() // 第二轮：仍未 pong → 判死
    expect(s.closed).toBe(true)
    expect(dead).toContain(c)
  })

  it('a connection that ponged survives the next tick', () => {
    const reg = new ConnectionRegistry()
    const s = new FakeSocket(); const c = reg.add(s)
    const dead: number[] = []
    const sched = fakeInterval()
    const hb = new Heartbeat(reg, sched, 30000, (connId) => dead.push(connId))
    hb.start()
    sched.tick()
    hb.onPong(c) // 模拟收到 pong
    sched.tick()
    expect(s.closed).toBe(false)
    expect(dead).toEqual([])
  })
})
