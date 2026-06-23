import type { GameEngine } from '../engine/contract'
import type { GameState } from '../engine/paodekuai/state'
import type { PdkAction, PdkEvent } from '../engine/paodekuai/rules'
import type { Transport } from './transport'
import type { SnapshotStore } from './snapshot'
import type { TimerScheduler } from './timer'
import { Room } from './room'

export interface RoomManagerDeps {
  engine: GameEngine<GameState, PdkAction, PdkEvent>
  transport: Transport
  store: SnapshotStore
  scheduler: TimerScheduler
  capacity: number
  turnMs: number
  // 每个房间一个 rng，调用方注入（测试传种子 rng，生产传 Math.random 包装）。
  rngFor: (roomId: string) => () => number
}

export class RoomManager {
  private rooms = new Map<string, Room>()

  constructor(private readonly deps: RoomManagerDeps) {}

  createRoom(roomId: string): Room {
    if (this.rooms.has(roomId)) throw new Error(`room ${roomId} already exists`)
    const room = new Room({
      roomId,
      engine: this.deps.engine,
      transport: this.deps.transport,
      store: this.deps.store,
      scheduler: this.deps.scheduler,
      rng: this.deps.rngFor(roomId),
      capacity: this.deps.capacity,
      turnMs: this.deps.turnMs,
    })
    this.rooms.set(roomId, room)
    return room
  }

  getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId)
  }

  destroyRoom(roomId: string): void {
    this.rooms.delete(roomId)
  }

  // 从快照重建房间（断线重连/进程重启）。无快照返回 null。
  async restoreRoom(roomId: string): Promise<Room | null> {
    const snapshot = await this.deps.store.load(roomId)
    if (!snapshot) return null
    const room = new Room({
      roomId,
      engine: this.deps.engine,
      transport: this.deps.transport,
      store: this.deps.store,
      scheduler: this.deps.scheduler,
      rng: this.deps.rngFor(roomId),
      capacity: this.deps.capacity,
      turnMs: this.deps.turnMs,
    })
    room.restoreFrom(snapshot)
    this.rooms.set(roomId, room)
    return room
  }
}
