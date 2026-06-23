import type { GameEngine } from '../engine/contract'
import type { GameState } from '../engine/paodekuai/state'
import type { PdkAction, PdkEvent } from '../engine/paodekuai/rules'
import { CommandQueue, type Command } from './command'
import { TurnTimer, type TimerScheduler } from './timer'
import type { Transport, ServerMessage } from './transport'
import type { SnapshotStore, RoomSnapshot } from './snapshot'
import type { Phase } from '../engine/paodekuai/state'

export interface RoomDeps {
  roomId: string
  engine: GameEngine<GameState, PdkAction, PdkEvent>
  transport: Transport
  store: SnapshotStore
  scheduler: TimerScheduler
  rng: () => number
  capacity: number
  turnMs: number
}

export class Room {
  private readonly queue: CommandQueue
  private readonly timer: TurnTimer
  private seatOrder: string[] = []   // 下标即引擎 playerIndex
  private state: GameState | null = null
  private turn = 0
  phase: Phase | 'WAITING' = 'WAITING'

  constructor(private readonly deps: RoomDeps) {
    this.queue = new CommandQueue((cmd) => this.handle(cmd))
    this.timer = new TurnTimer(deps.scheduler, deps.turnMs, (turn) =>
      this.queue.enqueue({ type: 'TIMEOUT', turn }))
  }

  enqueue(cmd: Command): void {
    this.queue.enqueue(cmd)
  }

  // 等待队列清空（测试用）。
  idle(): Promise<void> {
    return this.queue.drain()
  }

  private async handle(cmd: Command): Promise<void> {
    switch (cmd.type) {
      case 'JOIN': return this.onJoin(cmd.playerId)
      // PLAY/PASS/TIMEOUT/LEAVE 在 Task 6 实现
      default: return
    }
  }

  private async onJoin(playerId: string): Promise<void> {
    if (this.phase !== 'WAITING') {
      this.deps.transport.send(playerId, this.reject('ALREADY_STARTED'))
      return
    }
    if (this.seatOrder.includes(playerId)) {
      this.deps.transport.send(playerId, this.reject('ALREADY_JOINED'))
      return
    }
    if (this.seatOrder.length >= this.deps.capacity) {
      this.deps.transport.send(playerId, this.reject('ROOM_FULL'))
      return
    }
    this.seatOrder.push(playerId)
    if (this.seatOrder.length === this.deps.capacity) {
      this.start()
    }
  }

  private start(): void {
    this.state = this.deps.engine.createInitialState(this.seatOrder, this.deps.rng)
    this.phase = 'PLAYING'
    this.turn = 1
    this.broadcastState()
    void this.persist()
    this.timer.start(this.turn)
  }

  // 脱敏广播：给每个在座玩家发一份只含自己手牌的私有视图，
  // 同时给房间发一份公共 STATE（不含任何手牌明细）。
  private broadcastState(): void {
    const st = this.state!
    const publicView = {
      phase: st.phase,
      currentPlayer: st.currentPlayer,
      lastPlay: st.lastPlay,
      seatOrder: this.seatOrder,
      hands: st.players.map((p) => ({ playerId: p.id, handCount: p.hand.length })),
    }
    this.deps.transport.broadcast(this.deps.roomId, { type: 'STATE', payload: publicView })
    for (let i = 0; i < st.players.length; i++) {
      const me = st.players[i]!
      const view = {
        you: { playerId: me.id, hand: me.hand, seat: i },
        others: st.players
          .filter((_, j) => j !== i)
          .map((p) => ({ playerId: p.id, handCount: p.hand.length })),
        currentPlayer: st.currentPlayer,
        lastPlay: st.lastPlay,
      }
      this.deps.transport.send(me.id, { type: 'STATE', payload: view })
    }
  }

  private async persist(): Promise<void> {
    if (!this.state) return
    const snapshot: RoomSnapshot = {
      roomId: this.deps.roomId,
      seatOrder: this.seatOrder,
      phase: this.state.phase,
      turn: this.turn,
      game: this.state,
    }
    try {
      await this.deps.store.save(this.deps.roomId, snapshot)
    } catch {
      // 广播优先、快照异步：快照失败不影响对局，留待重试/下次覆盖。
    }
  }

  private reject(reason: string): ServerMessage {
    return { type: 'REJECTED', payload: { reason } }
  }
}
