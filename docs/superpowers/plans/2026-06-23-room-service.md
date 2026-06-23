# 房间服务（room）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现一个纯内存、可单测的房间服务，管理房间生命周期与成员、把玩家意图串行投递给 `GameEngine` 引擎、经抽象 `Transport` 接口广播脱敏状态、用计时器驱动超时代打，并通过整房间快照支撑断线重连。

**Architecture:** room 层通过三个接口解耦：向上依赖与玩法无关的 `GameEngine<S,A,E>` 契约（已实现），向下依赖 `Transport`（网络）与 `SnapshotStore`（持久），二者本轮提供内存/假实现。单房间串行靠命令队列，计时器到期入队 `TIMEOUT` command 并用 turn 版本号防过期误触。引擎是 `playerIndex`（座位号）语义，room 是 `playerId`（字符串）语义，room 持有座位顺序做双向映射，引擎零改动。详见 [room 设计 spec](../specs/2026-06-23-room-service-design.md)。

**Tech Stack:** Node.js v24 + TypeScript（ESM）、Vitest 测试、无运行时依赖。复用已有引擎 `server/src/engine/`。

---

## 环境注意（agentic worker 必读）

本沙箱 Node 直接跑 vitest 会段错误（`SecItemCopyMatching -67674`，exit 139）。**所有测试命令必须加前缀**，且先 `cd` 进 `server/`：

```
cd /Users/liudan/Documents/personal/card-room-miniapp/server && NODE_OPTIONS="--use-bundled-ca" npx vitest run <path>
```

不要跑 `npm install`（依赖已装好）。不要用 dangerouslyDisableSandbox。typecheck 用 `cd server && npm run typecheck`。

---

## 设计决策记录

- **接口解耦贯穿三层**：room 只通过 `GameEngine` / `Transport` / `SnapshotStore` 工作，不认识跑得快、不认识 WebSocket、不认识 Redis。可用假实现跑完整对局单测。
- **playerId ↔ seat index 映射**：引擎 `PdkAction` 用 `playerIndex`，room 用 `playerId`。座位顺序在 `engine.createInitialState(playerIds, rng)` 时固定为 `playerIds` 的下标顺序。room 保存这份 `seatOrder: string[]`，对外用 playerId、对引擎用 index，双向翻译。
- **广播优先、快照异步**：`step → 广播`是同步快路径；写快照是后台任务，不阻塞玩家手感。
- **turn 版本号防过期计时器**：每推进回合 +1，计时器携带起设时的回合号，处理 TIMEOUT 时比对，不匹配丢弃。
- **autoplay 不扩展引擎**：代打靠现有 `step` 试牌选合法动作，不给引擎加 `legalMoves`。等真有需要再用真实样本提炼。
- **rng 注入**：room 不调 `Math.random`，rng 由 `RoomManager.createRoom` 的调用方注入（测试传种子 rng，保证可复现）。

## File Structure

```
server/src/room/
  transport.ts                 # Transport 接口 + ServerMessage 类型
  transport.test.ts            # 假 transport 的录制行为测试
  snapshot.ts                  # SnapshotStore 接口 + InMemorySnapshotStore + RoomSnapshot 类型
  snapshot.test.ts
  command.ts                   # Command 类型 + CommandQueue（串行队列）
  command.test.ts
  autoplay.ts                  # chooseAutoMove：贪心试牌选合法动作
  autoplay.test.ts
  timer.ts                     # TurnTimer：起/清计时器，到期回调，带 turn 版本号
  timer.test.ts
  room.ts                      # Room 类：生命周期/成员/串行处理/调引擎/广播/快照
  room.test.ts                 # 含端到端"假 transport 跑完整对局"集成测试
  manager.ts                   # RoomManager：建/找/销毁 Room，从快照重建
  manager.test.ts
  index.ts                     # 对外导出
```

`room.ts` 是组装层，其余文件是它依赖的、可独立测试的零件。`autoplay.ts` 和 `timer.ts` 抽出来单独测，让 `room.ts` 的集成测试不必纠缠这些细节。

---

## Task 0: room 模块骨架与消息/状态类型（transport.ts）

定义 room 对外广播的消息形状和 Transport 接口。这是 room 与网络层的接缝。

**Files:**
- Create: `server/src/room/transport.ts`
- Test: `server/src/room/transport.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
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
```

- [ ] **Step 2: 运行确认失败**

Run: `cd /Users/liudan/Documents/personal/card-room-miniapp/server && NODE_OPTIONS="--use-bundled-ca" npx vitest run src/room/transport.test.ts`
Expected: FAIL — 模块/导出未定义。

- [ ] **Step 3: 实现 transport.ts**

```typescript
// room 广播给客户端的消息。payload 形状由各消息类型定义，
// 序列化由 transport 实现负责，room 只产出结构化对象。
export interface ServerMessage {
  type: string
  payload: unknown
}

// room 与网络层的接缝。gateway 实现真 WebSocket 版；测试用 RecordingTransport。
// room 永不认识 WebSocket。
export interface Transport {
  send(playerId: string, msg: ServerMessage): void
  broadcast(roomId: string, msg: ServerMessage): void
  kick(playerId: string): void
}

// 测试替身：录制所有调用，供断言。
export class RecordingTransport implements Transport {
  private broadcasts = new Map<string, ServerMessage[]>()
  private sends = new Map<string, ServerMessage[]>()
  readonly kicked: string[] = []

  send(playerId: string, msg: ServerMessage): void {
    const list = this.sends.get(playerId) ?? []
    list.push(msg)
    this.sends.set(playerId, list)
  }

  broadcast(roomId: string, msg: ServerMessage): void {
    const list = this.broadcasts.get(roomId) ?? []
    list.push(msg)
    this.broadcasts.set(roomId, list)
  }

  kick(playerId: string): void {
    this.kicked.push(playerId)
  }

  broadcastsTo(roomId: string): ServerMessage[] {
    return this.broadcasts.get(roomId) ?? []
  }

  sentTo(playerId: string): ServerMessage[] {
    return this.sends.get(playerId) ?? []
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd /Users/liudan/Documents/personal/card-room-miniapp/server && NODE_OPTIONS="--use-bundled-ca" npx vitest run src/room/transport.test.ts`
Expected: PASS（3 用例）。

- [ ] **Step 5: Commit**

```bash
cd /Users/liudan/Documents/personal/card-room-miniapp && git add server/src/room/transport.ts server/src/room/transport.test.ts && git commit -m "feat(room): Transport interface and recording test double"
```

---

## Task 1: 快照接口与内存实现（snapshot.ts）

定义整房间快照类型和存储接口，提供内存实现供测试。

**Files:**
- Create: `server/src/room/snapshot.ts`
- Test: `server/src/room/snapshot.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
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
```

- [ ] **Step 2: 运行确认失败**

Run: `cd /Users/liudan/Documents/personal/card-room-miniapp/server && NODE_OPTIONS="--use-bundled-ca" npx vitest run src/room/snapshot.test.ts`
Expected: FAIL — 模块/导出未定义。

- [ ] **Step 3: 实现 snapshot.ts**

```typescript
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
```

- [ ] **Step 4: 运行确认通过**

Run: `cd /Users/liudan/Documents/personal/card-room-miniapp/server && NODE_OPTIONS="--use-bundled-ca" npx vitest run src/room/snapshot.test.ts`
Expected: PASS（3 用例）。`JSON.stringify`/`parse` 天然实现深拷贝，第三个用例据此通过。

- [ ] **Step 5: Commit**

```bash
cd /Users/liudan/Documents/personal/card-room-miniapp && git add server/src/room/snapshot.ts server/src/room/snapshot.test.ts && git commit -m "feat(room): RoomSnapshot type and in-memory store"
```

---

## Task 2: 串行命令队列（command.ts）

定义进入房间的命令类型，以及保证单房间串行处理的队列。队列接受异步 handler，前一个处理完才取下一个，杜绝重入。

**Files:**
- Create: `server/src/room/command.ts`
- Test: `server/src/room/command.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
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
```

- [ ] **Step 2: 运行确认失败**

Run: `cd /Users/liudan/Documents/personal/card-room-miniapp/server && NODE_OPTIONS="--use-bundled-ca" npx vitest run src/room/command.test.ts`
Expected: FAIL — CommandQueue/Command 未定义。

- [ ] **Step 3: 实现 command.ts**

```typescript
import type { Card } from '../engine/paodekuai/card'

// 进入房间的命令。玩家意图、成员变更、计时器到期统一成命令走串行队列。
export type Command =
  | { type: 'PLAY'; playerId: string; cards: Card[] }
  | { type: 'PASS'; playerId: string }
  | { type: 'JOIN'; playerId: string }
  | { type: 'LEAVE'; playerId: string }
  | { type: 'TIMEOUT'; turn: number } // 计时器到期，带起设时的回合号

export type CommandHandler = (cmd: Command) => Promise<void>

// 单房间串行队列：前一个 handler 完成才处理下一个，杜绝并发改状态。
// 房间之间天然并行（各自一个队列）。
export class CommandQueue {
  private queue: Command[] = []
  private running = false
  private idleResolvers: Array<() => void> = []

  constructor(private readonly handler: CommandHandler) {}

  enqueue(cmd: Command): void {
    this.queue.push(cmd)
    if (!this.running) void this.run()
  }

  // 等待队列清空（测试与优雅关闭用）。
  drain(): Promise<void> {
    if (!this.running && this.queue.length === 0) return Promise.resolve()
    return new Promise((resolve) => this.idleResolvers.push(resolve))
  }

  private async run(): Promise<void> {
    this.running = true
    while (this.queue.length > 0) {
      const cmd = this.queue.shift()!
      await this.handler(cmd)
    }
    this.running = false
    const resolvers = this.idleResolvers
    this.idleResolvers = []
    for (const r of resolvers) r()
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd /Users/liudan/Documents/personal/card-room-miniapp/server && NODE_OPTIONS="--use-bundled-ca" npx vitest run src/room/command.test.ts`
Expected: PASS（3 用例）。串行性由 `start:PASS,end:PASS,start:JOIN,end:JOIN` 的不交错顺序证明。

- [ ] **Step 5: Commit**

```bash
cd /Users/liudan/Documents/personal/card-room-miniapp && git add server/src/room/command.ts server/src/room/command.test.ts && git commit -m "feat(room): Command types and serial CommandQueue"
```

---

## Task 3: 代打选牌（autoplay.ts）

超时/断线时 room 代玩家选一个合法动作。贪心：按牌力升序逐张试 PLAY，第一个不被引擎拒的即采用；全被拒则 PASS。只靠现有 `step`，不动引擎。

**Files:**
- Create: `server/src/room/autoplay.ts`
- Test: `server/src/room/autoplay.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
import { describe, it, expect } from 'vitest'
import { chooseAutoMove } from './autoplay'
import { PaodekuaiEngine } from '../engine/paodekuai/engine'
import type { GameState, PlayerState } from '../engine/paodekuai/state'
import type { Card } from '../engine/paodekuai/card'

const card = (rank: Card['rank'], suit: Card['suit'] = 'C'): Card => ({ rank, suit })
const engine = new PaodekuaiEngine()

describe('chooseAutoMove', () => {
  it('lead: plays the smallest legal single', () => {
    const players: PlayerState[] = [
      { id: 'p1', hand: [card('9'), card('5'), card('K')], finishedRank: null },
      { id: 'p2', hand: [card('4')], finishedRank: null },
      { id: 'p3', hand: [card('6')], finishedRank: null },
    ]
    const st: GameState = { players, kitty: [], currentPlayer: 0, lastPlay: null,
      passesSinceLastPlay: 0, phase: 'PLAYING', finishedCount: 0 }
    const action = chooseAutoMove(engine, st, 0)
    // 首家无人可压，必出最小单张 5（不是 PASS）
    expect(action).toEqual({ type: 'PLAY', playerIndex: 0, cards: [card('5')] })
  })

  it('following and cannot beat: returns PASS', () => {
    const players: PlayerState[] = [
      { id: 'p1', hand: [card('K')], finishedRank: null },
      { id: 'p2', hand: [card('4'), card('5')], finishedRank: null },
      { id: 'p3', hand: [card('6')], finishedRank: null },
    ]
    const st: GameState = { players, kitty: [], currentPlayer: 1,
      lastPlay: { playerIndex: 0, combo: { type: 'SINGLE', power: 11, length: 1, cards: [card('K')] } },
      passesSinceLastPlay: 0, phase: 'PLAYING', finishedCount: 0 }
    const action = chooseAutoMove(engine, st, 1)
    expect(action).toEqual({ type: 'PASS', playerIndex: 1 })
  })

  it('following and can beat: plays the smallest card that beats', () => {
    const players: PlayerState[] = [
      { id: 'p1', hand: [card('8')], finishedRank: null },
      { id: 'p2', hand: [card('6'), card('9'), card('Q')], finishedRank: null },
      { id: 'p3', hand: [card('3')], finishedRank: null },
    ]
    const st: GameState = { players, kitty: [], currentPlayer: 1,
      lastPlay: { playerIndex: 0, combo: { type: 'SINGLE', power: 5, length: 1, cards: [card('8')] } },
      passesSinceLastPlay: 0, phase: 'PLAYING', finishedCount: 0 }
    const action = chooseAutoMove(engine, st, 1)
    // 6 压不过 8，9 是能压的最小单张
    expect(action).toEqual({ type: 'PLAY', playerIndex: 1, cards: [card('9')] })
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd /Users/liudan/Documents/personal/card-room-miniapp/server && NODE_OPTIONS="--use-bundled-ca" npx vitest run src/room/autoplay.test.ts`
Expected: FAIL — chooseAutoMove 未定义。

- [ ] **Step 3: 实现 autoplay.ts**

```typescript
import type { GameEngine } from '../engine/contract'
import type { GameState } from '../engine/paodekuai/state'
import type { PdkAction, PdkEvent } from '../engine/paodekuai/rules'
import { rankValue } from '../engine/paodekuai/card'

// 超时/断线代打：选一个合法动作。贪心——按牌力升序逐张试单张 PLAY，
// 第一个不被引擎判 REJECTED 的即采用；全被拒则 PASS。只求合法不求最优。
// 仅依赖引擎的 step 判定，不扩展引擎契约。
export function chooseAutoMove(
  engine: GameEngine<GameState, PdkAction, PdkEvent>,
  state: GameState,
  playerIndex: number,
): PdkAction {
  const hand = state.players[playerIndex]!.hand
  const sorted = [...hand].sort((a, b) => rankValue(a.rank) - rankValue(b.rank))
  for (const c of sorted) {
    const candidate: PdkAction = { type: 'PLAY', playerIndex, cards: [c] }
    const { events } = engine.step(state, candidate)
    if (!events.some((e) => e.type === 'REJECTED')) return candidate
  }
  return { type: 'PASS', playerIndex }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd /Users/liudan/Documents/personal/card-room-miniapp/server && NODE_OPTIONS="--use-bundled-ca" npx vitest run src/room/autoplay.test.ts`
Expected: PASS（3 用例）。

- [ ] **Step 5: Commit**

```bash
cd /Users/liudan/Documents/personal/card-room-miniapp && git add server/src/room/autoplay.ts server/src/room/autoplay.test.ts && git commit -m "feat(room): greedy autoplay move selection"
```

---

## Task 4: 回合计时器（timer.ts）

轮到某人时起计时器，到期触发回调并带上起设时的回合号（turn 版本号）。回调只负责入队 TIMEOUT command，是否真代打由 Room 比对回合号决定。计时器用注入的 `setTimer` 抽象，测试用假时钟，不依赖真实时间。

**Files:**
- Create: `server/src/room/timer.ts`
- Test: `server/src/room/timer.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
import { describe, it, expect } from 'vitest'
import { TurnTimer, type TimerScheduler } from './timer'

// 假时钟：手动触发到期，不依赖真实时间。
function fakeScheduler(): TimerScheduler & { fireAll: () => void } {
  let pending: Array<{ id: number; cb: () => void }> = []
  let nextId = 1
  return {
    set(cb: () => void, _ms: number): number {
      const id = nextId++
      pending.push({ id, cb })
      return id
    },
    clear(id: number): void {
      pending = pending.filter((p) => p.id !== id)
    },
    fireAll(): void {
      const due = pending
      pending = []
      for (const p of due) p.cb()
    },
  }
}

describe('TurnTimer', () => {
  it('fires callback with the turn number it was started for', () => {
    const sched = fakeScheduler()
    const fired: number[] = []
    const timer = new TurnTimer(sched, 30000, (turn) => fired.push(turn))
    timer.start(7)
    sched.fireAll()
    expect(fired).toEqual([7])
  })

  it('clearing before fire produces no callback', () => {
    const sched = fakeScheduler()
    const fired: number[] = []
    const timer = new TurnTimer(sched, 30000, (turn) => fired.push(turn))
    timer.start(3)
    timer.clear()
    sched.fireAll()
    expect(fired).toEqual([])
  })

  it('starting a new turn clears the previous timer', () => {
    const sched = fakeScheduler()
    const fired: number[] = []
    const timer = new TurnTimer(sched, 30000, (turn) => fired.push(turn))
    timer.start(1)
    timer.start(2) // 应自动清掉 turn 1 的计时器
    sched.fireAll()
    expect(fired).toEqual([2])
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd /Users/liudan/Documents/personal/card-room-miniapp/server && NODE_OPTIONS="--use-bundled-ca" npx vitest run src/room/timer.test.ts`
Expected: FAIL — TurnTimer/TimerScheduler 未定义。

- [ ] **Step 3: 实现 timer.ts**

```typescript
// 计时器调度抽象。生产用 setTimeout/clearTimeout；测试用假时钟。
// 这样 room 不直接碰真实时间，计时逻辑可单测。
export interface TimerScheduler {
  set(cb: () => void, ms: number): number
  clear(id: number): void
}

// 生产实现：包 setTimeout。
export const realScheduler: TimerScheduler = {
  set: (cb, ms) => setTimeout(cb, ms) as unknown as number,
  clear: (id) => clearTimeout(id),
}

// 回合计时器：start(turn) 起计时，到期回调带上该 turn。
// 重新 start 或 clear 会取消上一个未触发的计时器。
export class TurnTimer {
  private activeId: number | null = null

  constructor(
    private readonly scheduler: TimerScheduler,
    private readonly ms: number,
    private readonly onTimeout: (turn: number) => void,
  ) {}

  start(turn: number): void {
    this.clear()
    this.activeId = this.scheduler.set(() => {
      this.activeId = null
      this.onTimeout(turn)
    }, this.ms)
  }

  clear(): void {
    if (this.activeId !== null) {
      this.scheduler.clear(this.activeId)
      this.activeId = null
    }
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd /Users/liudan/Documents/personal/card-room-miniapp/server && NODE_OPTIONS="--use-bundled-ca" npx vitest run src/room/timer.test.ts`
Expected: PASS（3 用例）。

- [ ] **Step 5: Commit**

```bash
cd /Users/liudan/Documents/personal/card-room-miniapp && git add server/src/room/timer.ts server/src/room/timer.test.ts && git commit -m "feat(room): turn timer with injectable scheduler"
```

---

## Task 5: Room 核心——建房、加入、开局、脱敏广播（room.ts 第一部分）

Room 把所有零件组装起来。本任务先实现：构造、JOIN 满员后开局、脱敏广播（每人只看到自己手牌）。出牌/超时在 Task 6 加。

**Files:**
- Create: `server/src/room/room.ts`
- Test: `server/src/room/room.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
import { describe, it, expect } from 'vitest'
import { Room } from './room'
import { PaodekuaiEngine } from '../engine/paodekuai/engine'
import { RecordingTransport, type ServerMessage } from './transport'
import { InMemorySnapshotStore } from './snapshot'
import { realScheduler } from './timer'

function seededRandom(seed: number): () => number {
  let s = seed >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0xffffffff }
}

function makeRoom(transport: RecordingTransport) {
  return new Room({
    roomId: 'r1',
    engine: new PaodekuaiEngine(),
    transport,
    store: new InMemorySnapshotStore(),
    scheduler: realScheduler,
    rng: seededRandom(123),
    capacity: 3,
    turnMs: 30000,
  })
}

function stateMsgs(t: RecordingTransport): ServerMessage[] {
  return t.broadcastsTo('r1').filter((m) => m.type === 'STATE')
}

describe('Room join and start', () => {
  it('starts the game when capacity is reached and broadcasts STATE', async () => {
    const t = new RecordingTransport()
    const room = makeRoom(t)
    room.enqueue({ type: 'JOIN', playerId: 'p1' })
    room.enqueue({ type: 'JOIN', playerId: 'p2' })
    room.enqueue({ type: 'JOIN', playerId: 'p3' })
    await room.idle()
    expect(room.phase).toBe('PLAYING')
    expect(stateMsgs(t).length).toBeGreaterThanOrEqual(1)
  })

  it('desensitizes: each player sees only their own hand', async () => {
    const t = new RecordingTransport()
    const room = makeRoom(t)
    room.enqueue({ type: 'JOIN', playerId: 'p1' })
    room.enqueue({ type: 'JOIN', playerId: 'p2' })
    room.enqueue({ type: 'JOIN', playerId: 'p3' })
    await room.idle()
    // 开局后每人收到一份私有视图：自己 hand 有牌，别人只有牌数
    const p1msgs = t.sentTo('p1').filter((m) => m.type === 'STATE')
    expect(p1msgs.length).toBeGreaterThanOrEqual(1)
    const view = p1msgs[p1msgs.length - 1]!.payload as {
      you: { hand: unknown[] }
      others: Array<{ playerId: string; handCount: number }>
    }
    expect(view.you.hand.length).toBe(16)
    expect(view.others).toHaveLength(2)
    for (const o of view.others) {
      expect(o.handCount).toBe(16)
      expect((o as Record<string, unknown>).hand).toBeUndefined()
    }
  })

  it('rejects join beyond capacity', async () => {
    const t = new RecordingTransport()
    const room = makeRoom(t)
    for (const id of ['p1','p2','p3','p4']) room.enqueue({ type: 'JOIN', playerId: id })
    await room.idle()
    expect(t.sentTo('p4').some((m) => m.type === 'REJECTED')).toBe(true)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd /Users/liudan/Documents/personal/card-room-miniapp/server && NODE_OPTIONS="--use-bundled-ca" npx vitest run src/room/room.test.ts`
Expected: FAIL — Room 未定义。

- [ ] **Step 3: 实现 room.ts**

```typescript
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
```

- [ ] **Step 4: 运行确认通过**

Run: `cd /Users/liudan/Documents/personal/card-room-miniapp/server && NODE_OPTIONS="--use-bundled-ca" npx vitest run src/room/room.test.ts`
Expected: PASS（3 用例）。

- [ ] **Step 5: Commit**

```bash
cd /Users/liudan/Documents/personal/card-room-miniapp && git add server/src/room/room.ts server/src/room/room.test.ts && git commit -m "feat(room): room join, start, desensitized broadcast"
```

---

## Task 6: Room 核心——出牌/过牌、超时代打、结算（room.ts 第二部分）

补全 Room 的 PLAY/PASS/TIMEOUT/LEAVE 处理：把 playerId 翻译成 playerIndex 投给引擎，按事件推进回合号与计时器，超时用 autoplay 代打，结束时广播 ranking。

**Files:**
- Modify: `server/src/room/room.ts`
- Test: `server/src/room/room.test.ts`（追加用例）

- [ ] **Step 1: 追加失败测试**（在 room.test.ts 已有 describe 块之后追加，不要新增 import；本块用到的符号 Task 5 已 import）

```typescript
describe('Room play, timeout, finish', () => {
  // 起一个已开局的房间，返回 room、transport，并给出当前该谁出牌的 playerId
  async function started() {
    const t = new RecordingTransport()
    const room = makeRoom(t)
    for (const id of ['p1','p2','p3']) room.enqueue({ type: 'JOIN', playerId: id })
    await room.idle()
    return { t, room }
  }

  it('rejects PLAY from a player who is not the current turn', async () => {
    const { t, room } = await started()
    const current = room.currentPlayerId()!
    const notCurrent = ['p1','p2','p3'].find((id) => id !== current)!
    room.enqueue({ type: 'PLAY', playerId: notCurrent, cards: [{ rank: '3', suit: 'D' }] })
    await room.idle()
    expect(t.sentTo(notCurrent).some(
      (m) => m.type === 'REJECTED'
        && (m.payload as { reason: string }).reason === 'NOT_YOUR_TURN')).toBe(true)
  })

  it('timeout triggers an autoplay move and advances the turn', async () => {
    const { room } = await started()
    const before = room.currentPlayerId()
    // 直接投递一个与当前回合号匹配的 TIMEOUT（模拟计时器到期）
    room.enqueue({ type: 'TIMEOUT', turn: room.currentTurn() })
    await room.idle()
    // 代打后回合应推进（除非这一手直接终局）
    expect(room.currentPlayerId() !== before || room.phase === 'FINISHED').toBe(true)
  })

  it('stale TIMEOUT (wrong turn number) is ignored', async () => {
    const { room } = await started()
    const before = room.currentPlayerId()
    room.enqueue({ type: 'TIMEOUT', turn: 999 }) // 过期回合号
    await room.idle()
    expect(room.currentPlayerId()).toBe(before)
    expect(room.phase).toBe('PLAYING')
  })

  it('plays a full game to completion via repeated timeouts and broadcasts GAME_OVER', async () => {
    const { t, room } = await started()
    let guard = 0
    while (room.phase === 'PLAYING' && guard < 3000) {
      guard++
      room.enqueue({ type: 'TIMEOUT', turn: room.currentTurn() })
      await room.idle()
    }
    expect(room.phase).toBe('FINISHED')
    const overMsgs = t.broadcastsTo('r1').filter((m) => m.type === 'GAME_OVER')
    expect(overMsgs).toHaveLength(1)
    const payload = overMsgs[0]!.payload as { ranking: Array<{ playerId: string; rank: number; score: number }> }
    expect(payload.ranking).toHaveLength(3)
    expect(payload.ranking[0]!.rank).toBe(1)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd /Users/liudan/Documents/personal/card-room-miniapp/server && NODE_OPTIONS="--use-bundled-ca" npx vitest run src/room/room.test.ts`
Expected: FAIL — currentPlayerId/currentTurn 未定义、PLAY/TIMEOUT 未处理。

- [ ] **Step 3: 扩展 room.ts**

在 import 区追加：

```typescript
import { chooseAutoMove } from './autoplay'
```

在 `Room` 类中追加这几个公开读取方法（供测试与 gateway 用）：

```typescript
  currentPlayerId(): string | null {
    if (!this.state || this.phase !== 'PLAYING') return null
    return this.seatOrder[this.state.currentPlayer] ?? null
  }

  currentTurn(): number {
    return this.turn
  }
```

把 `handle` 的 switch 补全为：

```typescript
  private async handle(cmd: Command): Promise<void> {
    switch (cmd.type) {
      case 'JOIN': return this.onJoin(cmd.playerId)
      case 'PLAY': return this.onAction(cmd.playerId, { kind: 'PLAY', cards: cmd.cards })
      case 'PASS': return this.onAction(cmd.playerId, { kind: 'PASS' })
      case 'TIMEOUT': return this.onTimeout(cmd.turn)
      case 'LEAVE': return this.onLeave(cmd.playerId)
    }
  }
```

追加动作处理方法（注意 playerId → playerIndex 的翻译，以及"广播优先、快照异步"）：

```typescript
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
    const action = chooseAutoMove(this.deps.engine, this.state, seat)
    this.applyAction(action, this.seatOrder[seat]!)
  }

  private async onLeave(playerId: string): Promise<void> {
    // 体验版：离座不结束牌局，轮到该座位时由超时代打兜底。
    // 仅在等待阶段允许真正退出席位。
    if (this.phase === 'WAITING') {
      this.seatOrder = this.seatOrder.filter((id) => id !== playerId)
    }
  }

  // 把动作交引擎、按事件推进，并执行广播优先/快照异步/计时器管理。
  private applyAction(action: PdkAction, actingPlayerId: string): void {
    const { state, events } = this.deps.engine.step(this.state!, action)
    const rejected = events.find((e) => e.type === 'REJECTED')
    if (rejected) {
      // 非法意图只回发给本人，不改状态、不动计时器。
      this.deps.transport.send(actingPlayerId,
        { type: 'REJECTED', payload: { reason: rejected.reason } })
      return
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
      return
    }

    this.broadcastState()        // 同步快路径
    void this.persist()          // 异步慢路径
    this.timer.start(this.turn)  // 给下一位起计时器
  }
```

> 注：`applyAction` 推进 `this.turn += 1` 后再 `timer.start(this.turn)`，使新计时器携带新回合号；任何在此之前设置的旧计时器到期都会因 `turn !== this.turn` 被 `onTimeout` 丢弃。

- [ ] **Step 4: 运行确认通过**

Run: `cd /Users/liudan/Documents/personal/card-room-miniapp/server && NODE_OPTIONS="--use-bundled-ca" npx vitest run src/room/room.test.ts`
Expected: PASS（Task 5 的 3 个 + 本任务 4 个 = 7 用例）。

- [ ] **Step 5: Commit**

```bash
cd /Users/liudan/Documents/personal/card-room-miniapp && git add server/src/room/room.ts server/src/room/room.test.ts && git commit -m "feat(room): play/pass, timeout autoplay, finish and ranking"
```

---

## Task 7: RoomManager——建/找/销毁与从快照重建（manager.ts）

按 roomId 管理多个 Room；提供从 `SnapshotStore` 重建 Room 的能力（断线重连基础）。重建后状态与原 Room 一致。

**Files:**
- Create: `server/src/room/manager.ts`
- Test: `server/src/room/manager.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
import { describe, it, expect } from 'vitest'
import { RoomManager } from './manager'
import { PaodekuaiEngine } from '../engine/paodekuai/engine'
import { RecordingTransport } from './transport'
import { InMemorySnapshotStore } from './snapshot'
import { realScheduler } from './timer'

function seededRandom(seed: number): () => number {
  let s = seed >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0xffffffff }
}

function makeManager(store = new InMemorySnapshotStore()) {
  const transport = new RecordingTransport()
  const mgr = new RoomManager({
    engine: new PaodekuaiEngine(),
    transport,
    store,
    scheduler: realScheduler,
    capacity: 3,
    turnMs: 30000,
    rngFor: () => seededRandom(123),
  })
  return { mgr, transport, store }
}

describe('RoomManager', () => {
  it('creates and finds a room by id', () => {
    const { mgr } = makeManager()
    const room = mgr.createRoom('r1')
    expect(mgr.getRoom('r1')).toBe(room)
  })

  it('rejects creating a room id that already exists', () => {
    const { mgr } = makeManager()
    mgr.createRoom('r1')
    expect(() => mgr.createRoom('r1')).toThrow()
  })

  it('destroyRoom removes it', () => {
    const { mgr } = makeManager()
    mgr.createRoom('r1')
    mgr.destroyRoom('r1')
    expect(mgr.getRoom('r1')).toBeUndefined()
  })

  it('restores a room from snapshot with matching state', async () => {
    const store = new InMemorySnapshotStore()
    const { mgr } = makeManager(store)
    const room = mgr.createRoom('r1')
    for (const id of ['p1','p2','p3']) room.enqueue({ type: 'JOIN', playerId: id })
    await room.idle()
    const turnBefore = room.currentTurn()
    const currentBefore = room.currentPlayerId()

    // 模拟进程重启：销毁内存中的房间，从快照重建
    mgr.destroyRoom('r1')
    expect(mgr.getRoom('r1')).toBeUndefined()
    const restored = await mgr.restoreRoom('r1')
    expect(restored).not.toBeNull()
    expect(restored!.currentTurn()).toBe(turnBefore)
    expect(restored!.currentPlayerId()).toBe(currentBefore)
    expect(restored!.phase).toBe('PLAYING')
  })

  it('restoreRoom returns null when no snapshot exists', async () => {
    const { mgr } = makeManager()
    expect(await mgr.restoreRoom('ghost')).toBeNull()
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd /Users/liudan/Documents/personal/card-room-miniapp/server && NODE_OPTIONS="--use-bundled-ca" npx vitest run src/room/manager.test.ts`
Expected: FAIL — RoomManager 未定义。

- [ ] **Step 3: 实现 manager.ts，并给 Room 加一个从快照重建的入口**

先在 `room.ts` 的 `Room` 类中追加一个静态/实例方法用于注入已有状态（重建用）。在 `Room` 类内追加：

```typescript
  // 从快照重建：直接灌入座位、状态、回合号，不重新发牌。
  restoreFrom(snapshot: RoomSnapshot): void {
    this.seatOrder = [...snapshot.seatOrder]
    this.state = snapshot.game
    this.turn = snapshot.turn
    this.phase = snapshot.phase
    if (this.phase === 'PLAYING') this.timer.start(this.turn)
  }
```

> 注：`restoreFrom` 复用构造时已建好的 `queue`/`timer`，只替换状态字段。`RoomSnapshot` 已在 room.ts 顶部 import。

然后实现 `manager.ts`：

```typescript
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
```

- [ ] **Step 4: 运行确认通过**

Run: `cd /Users/liudan/Documents/personal/card-room-miniapp/server && NODE_OPTIONS="--use-bundled-ca" npx vitest run src/room/manager.test.ts`
Expected: PASS（5 用例）。

- [ ] **Step 5: Commit**

```bash
cd /Users/liudan/Documents/personal/card-room-miniapp && git add server/src/room/manager.ts server/src/room/room.ts server/src/room/manager.test.ts && git commit -m "feat(room): RoomManager with snapshot restore"
```

---

## Task 8: 对外导出 + 全量验证（index.ts）

**Files:**
- Create: `server/src/room/index.ts`

- [ ] **Step 1: 实现 index.ts**

```typescript
export { Room } from './room'
export type { RoomDeps } from './room'
export { RoomManager } from './manager'
export type { RoomManagerDeps } from './manager'
export { CommandQueue } from './command'
export type { Command, CommandHandler } from './command'
export { TurnTimer, realScheduler } from './timer'
export type { TimerScheduler } from './timer'
export { chooseAutoMove } from './autoplay'
export { InMemorySnapshotStore } from './snapshot'
export type { SnapshotStore, RoomSnapshot } from './snapshot'
export { RecordingTransport } from './transport'
export type { Transport, ServerMessage } from './transport'
```

- [ ] **Step 2: 全量测试 + 类型检查**

Run: `cd /Users/liudan/Documents/personal/card-room-miniapp/server && NODE_OPTIONS="--use-bundled-ca" npx vitest run && npm run typecheck`
Expected: 全部 PASS（引擎 36 + room 各任务用例）；typecheck 无错误。

- [ ] **Step 3: Commit**

```bash
cd /Users/liudan/Documents/personal/card-room-miniapp && git add server/src/room/index.ts && git commit -m "feat(room): public exports for room module"
```

---

## 完成标准

- room 核心零外部依赖，`npm test` 全绿，`npm run typecheck` 无错误。
- 一个 Room 可用 `RecordingTransport` + `InMemorySnapshotStore` 跑完整对局到 `GAME_OVER`，`ranking` 广播带 playerId+rank+score。
- 超时（TIMEOUT command）触发合法代打；过期回合号的 TIMEOUT 被丢弃不误触发。
- 脱敏正确：玩家私有视图含自己手牌，他人只见手牌数。
- 从 `RoomSnapshot` 重建的 Room 与原状态一致（回合号、当前玩家、阶段）。
- room 只通过 `GameEngine` / `Transport` / `SnapshotStore` 三个接口工作。

## 后续计划（各自独立成文，不在本计划内）

- gateway：真 WebSocket 连接管理、心跳、断线检测，实现 `Transport`，把入站消息翻译成 `Command` 投给对应 Room。
- Redis 适配层：实现 `SnapshotStore`，对接真 Redis，跑接口契约测试。
- 持久层：PostgreSQL，消费 `ranking()` 的 score 落库积分与战绩。
- 第二个玩法接入时：用跑得快 + 新玩法两个样本提炼公共抽象（含是否需要 `legalMoves`）。
