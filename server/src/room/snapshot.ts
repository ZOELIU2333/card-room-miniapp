import type { GameState } from '../engine/paodekuai/state'
import type { Phase } from '../engine/paodekuai/state'

// 整房间快照：成员座位顺序 + 房间阶段 + 回合号 + 引擎状态。
// 整块序列化，恢复即整块重建。room 状态量小，整块读写开销可忽略。
export interface RoomSnapshot {
  roomId: string
  seatOrder: string[]       // 下标 i 即引擎 playerIndex i 的 playerId
  phase: Phase
  turn: number
  game: GameState
}

// room 状态持久接口。内存实现用于测试；Redis 实现是薄适配层。
export interface SnapshotStore {
  save(roomId: string, snapshot: RoomSnapshot): Promise<void>
  load(roomId: string): Promise<RoomSnapshot | null>
}

export class InMemorySnapshotStore implements SnapshotStore {
  private store = new Map<string, string>()

  async save(roomId: string, snapshot: RoomSnapshot): Promise<void> {
    this.store.set(roomId, JSON.stringify(snapshot))
  }

  async load(roomId: string): Promise<RoomSnapshot | null> {
    const raw = this.store.get(roomId)
    return raw ? (JSON.parse(raw) as RoomSnapshot) : null
  }
}
