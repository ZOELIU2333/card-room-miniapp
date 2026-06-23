import { describe, it, expect } from 'vitest'
import { FakeSocket } from './socket'

describe('FakeSocket (test double)', () => {
  it('records sent text frames', () => {
    const s = new FakeSocket()
    s.send('hello')
    s.send('world')
    expect(s.sent).toEqual(['hello', 'world'])
  })
  it('emits message to a registered handler', () => {
    const s = new FakeSocket()
    const got: string[] = []
    s.on('message', (data) => got.push(data))
    s.receive('hi')
    expect(got).toEqual(['hi'])
  })
  it('close marks closed and fires close handler', () => {
    const s = new FakeSocket()
    let closed = false
    s.on('close', () => { closed = true })
    s.close()
    expect(s.closed).toBe(true)
    expect(closed).toBe(true)
  })
  it('pong handler fires when a pong is simulated', () => {
    const s = new FakeSocket()
    let pongs = 0
    s.on('pong', () => { pongs++ })
    s.simulatePong()
    expect(pongs).toBe(1)
  })
  it('terminate marks closed without firing close handler twice', () => {
    const s = new FakeSocket()
    let closes = 0
    s.on('close', () => { closes++ })
    s.terminate()
    expect(s.closed).toBe(true)
    expect(closes).toBe(1)
  })
})
