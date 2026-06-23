import { describe, it, expect } from 'vitest'
import { CommandQueue, type Command } from './command'

describe('Command type', () => {
  it('supports PLAY/PASS/JOIN/LEAVE/TIMEOUT shapes', () => {
    const cmds: Command[] = [
      { type: 'PLAY', playerId: 'p1', cards: [{ rank: '3', suit: 'D' }] },
      { type: 'PASS', playerId: 'p1' },
      { type: 'JOIN', playerId: 'p2' },
      { type: 'LEAVE', playerId: 'p2' },
      { type: 'TIMEOUT', turn: 7 },
    ]
    expect(cmds).toHaveLength(5)
  })
})

describe('CommandQueue serial execution', () => {
  it('runs handlers one at a time even when enqueued concurrently', async () => {
    const order: string[] = []
    const q = new CommandQueue(async (c) => {
      order.push(`start:${c.type}`)
      await new Promise((r) => setTimeout(r, 5))
      order.push(`end:${c.type}`)
    })
    q.enqueue({ type: 'PASS', playerId: 'p1' })
    q.enqueue({ type: 'JOIN', playerId: 'p2' })
    await q.drain()
    // 必须是 start/end 成对、不交错
    expect(order).toEqual(['start:PASS','end:PASS','start:JOIN','end:JOIN'])
  })
  it('drain resolves when queue is empty', async () => {
    const q = new CommandQueue(async () => {})
    await q.drain()
    expect(true).toBe(true)
  })
})
