import type { GameEngine } from '../engine/contract'
import type { GameState } from '../engine/paodekuai/state'
import type { PdkAction, PdkEvent } from '../engine/paodekuai/rules'
import { CommandQueue, type Command } from './command'
import { TurnTimer, type TimerScheduler } from './timer'
import type { Transport, ServerMessage } from './transport'
import type { SnapshotStore, RoomSnapshot } from './snapshot'
import type { Phase } from '../engine/paodekuai/state'
import type { DeckVariant } from '../engine/paodekuai/deck'
import { chooseAutoMove } from './autoplay'

export interface RoomDeps {
  roomId: string
  engine: GameEngine<GameState, PdkAction, PdkEvent>
  transport: Transport
  store: SnapshotStore
  scheduler: TimerScheduler
  rng: () => number
  capacity: number
  turnMs: number
  variant: DeckVariant
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

  // gateway 在投递 JOIN 命令前先问一次能否加入，避免乐观提交成员关系。
  // 与 onJoin 的判定一致；不改状态。
  canJoin(playerId: string): { ok: true } | { ok: false; reason: 'ALREADY_STARTED' | 'ALREADY_JOINED' | 'ROOM_FULL' } {
    if (this.phase !== 'WAITING') return { ok: false, reason: 'ALREADY_STARTED' }
    if (this.seatOrder.includes(playerId)) return { ok: false, reason: 'ALREADY_JOINED' }
    if (this.seatOrder.length >= this.deps.capacity) return { ok: false, reason: 'ROOM_FULL' }
    return { ok: true }
  }

  // 等待队列清空（测试用）。
  idle(): Promise<void> {
    return this.queue.drain()
  }

  currentPlayerId(): string | null {
    if (!this.state || this.phase !== 'PLAYING') return null
    return this.seatOrder[this.state.currentPlayer] ?? null
  }

  currentTurn(): number {
    return this.turn
  }

  // 断线重连后，把当前脱敏状态重推给单个玩家（gateway RESUME 用）。
  // 仅在对局进行中且该玩家在座时有效。
  resyncTo(playerId: string): void {
    if (!this.state || this.phase === 'WAITING') return
    const i = this.seatOrder.indexOf(playerId)
    if (i === -1) return
    const st = this.state
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

  // 从快照重建：直接灌入座位、状态、回合号，不重新发牌。
  restoreFrom(snapshot: RoomSnapshot): void {
    this.seatOrder = [...snapshot.seatOrder]
    this.state = snapshot.game
    this.turn = snapshot.turn
    this.phase = snapshot.phase
    if (this.phase === 'PLAYING') this.timer.start(this.turn)
  }

  private async handle(cmd: Command): Promise<void> {
    switch (cmd.type) {
      case 'JOIN': return this.onJoin(cmd.playerId)
      case 'PLAY': return this.onAction(cmd.playerId, { kind: 'PLAY', cards: cmd.cards })
      case 'PASS': return this.onAction(cmd.playerId, { kind: 'PASS' })
      case 'TIMEOUT': return this.onTimeout(cmd.turn)
      case 'LEAVE': return this.onLeave(cmd.playerId)
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

  private seatOf(playerId: string): number {
    return this.seatOrder.indexOf(playerId)
  }

  // 处理玩家主动 PLAY/PASS。
  private async onAction(
    playerId: string,
    intent: { kind: 'PLAY'; cards: import('../engine/paodekuai/card').Card[] } | { kind: 'PASS' },
  ): Promise<void> {
    if (!this.state || this.phase !== 'PLAYING') {
      this.deps.transport.send(playerId, this.reject('GAME_NOT_PLAYING'))
      return
    }
    const seat = this.seatOf(playerId)
    if (seat === -1 || seat !== this.state.currentPlayer) {
      this.deps.transport.send(playerId, this.reject('NOT_YOUR_TURN'))
      return
    }
    const action: PdkAction = intent.kind === 'PLAY'
      ? { type: 'PLAY', playerIndex: seat, cards: intent.cards }
      : { type: 'PASS', playerIndex: seat }
    this.applyAction(action, playerId)
  }

  // 计时器到期：比对回合号防过期，匹配则 autoplay 代打。
  private async onTimeout(turn: number): Promise<void> {
    if (!this.state || this.phase !== 'PLAYING' || turn !== this.turn) return
    const seat = this.state.currentPlayer
    const playerId = this.seatOrder[seat]!
    const action = chooseAutoMove(this.deps.engine, this.state, seat)
    const accepted = this.applyAction(action, playerId)
    // 防御：万一代打选出的动作被引擎拒（理论上不会，chooseAutoMove 只选合法动作），
    // 退一步尝试 PASS，保证回合不会因代打失败而卡死。
    if (!accepted) {
      this.applyAction({ type: 'PASS', playerIndex: seat }, playerId)
    }
  }

  private async onLeave(playerId: string): Promise<void> {
    // 体验版：离座不结束牌局，轮到该座位时由超时代打兜底。
    // 仅在等待阶段允许真正退出席位。
    if (this.phase === 'WAITING') {
      this.seatOrder = this.seatOrder.filter((id) => id !== playerId)
    }
  }

  // 把动作交引擎、按事件推进，并执行广播优先/快照异步/计时器管理。
  // 返回 true 表示动作被引擎接受并推进；false 表示被拒（状态未变）。
  private applyAction(action: PdkAction, actingPlayerId: string): boolean {
    const { state, events } = this.deps.engine.step(this.state!, action)
    const rejected = events.find(
      (e): e is Extract<PdkEvent, { type: 'REJECTED' }> => e.type === 'REJECTED',
    )
    if (rejected) {
      // 非法意图只回发给本人，不改状态、不动计时器。
      this.deps.transport.send(actingPlayerId,
        { type: 'REJECTED', payload: { reason: rejected.reason } })
      return false
    }
    this.state = state
    this.turn += 1
    this.timer.clear()

    if (this.deps.engine.isFinished(state)) {
      this.phase = 'FINISHED'
      this.broadcastState()
      this.deps.transport.broadcast(this.deps.roomId, {
        type: 'GAME_OVER',
        payload: { ranking: this.deps.engine.ranking(state) },
      })
      void this.persist()
      return true
    }

    this.broadcastState()        // 同步快路径
    void this.persist()          // 异步慢路径
    this.timer.start(this.turn)  // 给下一位起计时器
    return true
  }

  private start(): void {
    this.state = this.deps.engine.createInitialState(this.seatOrder, this.deps.rng, this.deps.variant)
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
