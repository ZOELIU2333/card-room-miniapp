import { describe, it, expect } from 'vitest'
import { RecordingTransport } from './transport'

describe('RecordingTransport (test double)', () => {
  it('records broadcast messages per room', () => {
    const t = new RecordingTransport()
    t.broadcast('room1', { type: 'STATE', payload: { phase: 'PLAYING' } })
    t.broadcast('room1', { type: 'GAME_OVER', payload: { ranking: [] } })
    expect(t.broadcastsTo('room1')).toHaveLength(2)
    expect(t.broadcastsTo('room1')[0]).toMatchObject({ type: 'STATE' })
  })
  it('records direct sends per player', () => {
    const t = new RecordingTransport()
    t.send('p1', { type: 'REJECTED', payload: { reason: 'NOT_YOUR_TURN' } })
    expect(t.sentTo('p1')).toHaveLength(1)
    expect(t.sentTo('p1')[0]).toMatchObject({ type: 'REJECTED' })
  })
  it('records kicked players', () => {
    const t = new RecordingTransport()
    t.kick('p2')
    expect(t.kicked).toContain('p2')
  })
})
