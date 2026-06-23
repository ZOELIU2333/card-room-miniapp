import { describe, it, expect } from 'vitest'
import { InMemorySnapshotStore, type RoomSnapshot } from './snapshot'
import type { GameState } from '../engine/paodekuai/state'

function fakeSnapshot(roomId: string): RoomSnapshot {
  const game: GameState = {
    players: [{ id: 'p1', hand: [], finishedRank: null }],
    kitty: [], currentPlayer: 0, lastPlay: null,
    passesSinceLastPlay: 0, phase: 'PLAYING', finishedCount: 0,
  }
  return { roomId, seatOrder: ['p1','p2','p3'], phase: 'PLAYING', turn: 5, game }
}

describe('InMemorySnapshotStore', () => {
  it('save then load returns equal snapshot', async () => {
    const store = new InMemorySnapshotStore()
    const snap = fakeSnapshot('r1')
    await store.save('r1', snap)
    expect(await store.load('r1')).toEqual(snap)
  })
  it('load missing room returns null', async () => {
    const store = new InMemorySnapshotStore()
    expect(await store.load('nope')).toBeNull()
  })
  it('stores a deep copy so later mutation does not leak in', async () => {
    const store = new InMemorySnapshotStore()
    const snap = fakeSnapshot('r1')
    await store.save('r1', snap)
    snap.turn = 999
    const loaded = await store.load('r1')
    expect(loaded?.turn).toBe(5)
  })
})
