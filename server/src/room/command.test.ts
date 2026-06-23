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
  it('a throwing handler does not wedge the queue: later commands still run and drain resolves', async () => {
    const seen: string[] = []
    const q = new CommandQueue(async (c) => {
      if (c.type === 'PASS') throw new Error('boom')
      seen.push(c.type)
    })
    q.enqueue({ type: 'PASS', playerId: 'p1' }) // handler throws on this one
    q.enqueue({ type: 'JOIN', playerId: 'p2' }) // must still be processed
    await q.drain() // must resolve, not hang
    expect(seen).toEqual(['JOIN'])
  })
})
