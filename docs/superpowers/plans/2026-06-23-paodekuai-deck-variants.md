# 跑得快 15/16 张双玩法 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让跑得快引擎支持 15 张和 16 张两种发牌玩法，建房时由 CREATE 消息选定，每房独立。

**Architecture:** 玩法是引擎初始化选项 `DeckVariant`，沿 `CREATE 消息 → RoomManager.createRoom → Room → engine.createInitialState` 透传。牌堆裁剪与发牌张数全部收敛在引擎层；`combo`/`rules` 不变。默认 `'classic16'` 保证现有调用零改动。

**Tech Stack:** TypeScript ESM、Vitest、ws。命令一律从 `server/` 目录跑，前缀 `NODE_OPTIONS="--use-bundled-ca"`。

**关键约束（环境）：**
- 测试：`NODE_OPTIONS="--use-bundled-ca" ./node_modules/.bin/vitest run`（从 `server/`）。
- typecheck：`NODE_OPTIONS="--use-bundled-ca" ./node_modules/.bin/tsc --noEmit`（从 `server/`）。
- `tsconfig` 开了 `verbatimModuleSyntax`（类型导入必须 `import type`）和 `noUncheckedIndexedAccess`（数组下标取值后非空需 `!` 或判空）。
- 测试种子 rng 统一用各测试文件已有的 `seededRandom(seed)` 工具（见每个 test 文件顶部）。

---

## File Structure

| 文件 | 职责 | 改动 |
|---|---|---|
| `src/engine/paodekuai/deck.ts` | 牌堆生成与发牌 | 新增 `DeckVariant`、`makeDeck(variant)` |
| `src/engine/paodekuai/deck.test.ts` | deck 单测 | 新增 makeDeck 用例 |
| `src/engine/contract.ts` | 引擎契约 | `createInitialState` 签名加 `variant` |
| `src/engine/paodekuai/state.ts` | 初始局面 | 按 variant 选牌堆 + perPlayer |
| `src/engine/paodekuai/state.test.ts` | state 单测 | 新增 15 张用例 |
| `src/engine/paodekuai/engine.ts` | 引擎实现 | 透传 variant |
| `src/room/room.ts` | 单房间逻辑 | `RoomDeps.variant` + start 透传 |
| `src/room/manager.ts` | 房间工厂 | `createRoom(roomId, variant?)` + restoreRoom 默认 variant |
| `src/room/manager.test.ts` | manager 单测 | 新增 variant 透传用例 |
| `src/gateway/protocol.ts` | 入站消息解析 | CREATE 带 variant、宽松校验 |
| `src/gateway/protocol.test.ts` | 协议单测 | 新增 variant 解析用例（文件可能不存在，见 Task 6） |
| `src/gateway/gateway.ts` | ws 路由 | CREATE/JOIN 拆分、JOIN 空房拒 |
| `src/gateway/gateway.test.ts` | gateway 单测 | 新增 15 张开局 + JOIN 空房拒用例 |
| `scripts/e2e-smoke.mjs` | 端到端验证 | 加 classic15 轮次 |

---

## Task 1: 牌堆裁剪 — `DeckVariant` 与 `makeDeck`

**Files:**
- Modify: `src/engine/paodekuai/deck.ts`
- Test: `src/engine/paodekuai/deck.test.ts`

`makeFullDeck` 现住在 `card.ts:17`，返回 `Array<Card & { id: string }>`（52 张）。本任务在 `deck.ts` 新增玩法类型与裁剪函数，复用 `makeFullDeck`。

- [ ] **Step 1: 写失败测试**

在 `src/engine/paodekuai/deck.test.ts` 末尾、最后一个 `})` 之前补充。先在文件顶部 import 行加入 `makeDeck`：把现有 `import { makeFullDeck } from './card'` 保留，新增一行 `import { makeDeck } from './deck'`（`shuffle, deal` 已从 './deck' 导入，可合并：`import { shuffle, deal, makeDeck } from './deck'`）。

测试体：

```typescript
describe('makeDeck variants', () => {
  it('classic16 returns the full 52-card deck', () => {
    expect(makeDeck('classic16')).toHaveLength(52)
  })
  it('classic15 returns 45 cards', () => {
    expect(makeDeck('classic15')).toHaveLength(45)
  })
  it('classic15 keeps only spade 2 and spade A among 2s and As', () => {
    const d = makeDeck('classic15')
    const twos = d.filter((c) => c.rank === '2')
    const aces = d.filter((c) => c.rank === 'A')
    expect(twos).toHaveLength(1)
    expect(twos[0]!.suit).toBe('S')
    expect(aces).toHaveLength(1)
    expect(aces[0]!.suit).toBe('S')
  })
  it('classic15 drops exactly one K (3 remain) and keeps diamond 3', () => {
    const d = makeDeck('classic15')
    expect(d.filter((c) => c.rank === 'K')).toHaveLength(3)
    expect(d.some((c) => c.rank === '3' && c.suit === 'D')).toBe(true)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `NODE_OPTIONS="--use-bundled-ca" ./node_modules/.bin/vitest run src/engine/paodekuai/deck.test.ts`
Expected: FAIL，报 `makeDeck` 不存在（"makeDeck is not exported" 或类型错误）。

- [ ] **Step 3: 实现 makeDeck**

在 `src/engine/paodekuai/deck.ts` 顶部，把第 1 行的 import 改为同时引入 `makeFullDeck`：

```typescript
import type { Card } from './card'
import { makeFullDeck } from './card'
```

在文件末尾追加：

```typescript
export type DeckVariant = 'classic16' | 'classic15'

// classic16：整副 52 张。classic15：去 3 个 2（留黑桃2）、3 个 A（留黑桃A）、
// 1 个方块 K，共 45 张，3 人各 15 发完无 kitty。其余规则不变。
export function makeDeck(variant: DeckVariant): CardWithId[] {
  const full = makeFullDeck()
  if (variant === 'classic16') return full
  return full.filter((c) => {
    if (c.rank === '2' && c.suit !== 'S') return false
    if (c.rank === 'A' && c.suit !== 'S') return false
    if (c.rank === 'K' && c.suit === 'D') return false
    return true
  })
}
```

注：`CardWithId` 已在 `deck.ts:3` 定义为 `type CardWithId = Card & { id: string }`，`makeFullDeck()` 的返回类型与之结构一致，可直接返回。

- [ ] **Step 4: 跑测试确认通过**

Run: `NODE_OPTIONS="--use-bundled-ca" ./node_modules/.bin/vitest run src/engine/paodekuai/deck.test.ts`
Expected: PASS（含原有 3 个 + 新增 4 个）。

- [ ] **Step 5: 提交**

```bash
git add src/engine/paodekuai/deck.ts src/engine/paodekuai/deck.test.ts
git commit -m "feat(engine): makeDeck with classic15/classic16 variants"
```

---

## Task 2: 引擎契约签名加 `variant`

**Files:**
- Modify: `src/engine/contract.ts:28`

这是纯签名改动，下游（state/engine）在 Task 3 跟上。本任务单独提交，保持改动可读。

- [ ] **Step 1: 改契约签名**

`src/engine/contract.ts` 第 28 行当前为：

```typescript
  createInitialState(playerIds: string[], rng: () => number): S
```

改为（用全局类型参 `V` 表达玩法，避免引擎契约依赖跑得快具体类型）：

```typescript
  createInitialState(playerIds: string[], rng: () => number, variant: V): S
```

并把接口声明从 `export interface GameEngine<S, A, E> {`（第 26 行）改为 `export interface GameEngine<S, A, E, V = unknown> {`。`V = unknown` 默认值保证其他潜在实现无需立即改签名。

- [ ] **Step 2: 跑 typecheck 确认下游报错（预期失败）**

Run: `NODE_OPTIONS="--use-bundled-ca" ./node_modules/.bin/tsc --noEmit`
Expected: FAIL —— `engine.ts` 的 `createInitialState` 实现缺 `variant` 参数、`PaodekuaiEngine implements GameEngine<...>` 类型参数个数不匹配。这些在 Task 3 修复。

- [ ] **Step 3: 提交（契约先行）**

```bash
git add src/engine/contract.ts
git commit -m "feat(engine): add variant param to createInitialState contract"
```

注：此提交后 typecheck 暂时红，Task 3 立即修复。subagent 执行时 Task 2、3 连续做，不在中间交付。

---

## Task 3: `state` 与 `engine` 按 variant 发牌

**Files:**
- Modify: `src/engine/paodekuai/state.ts:26-37`
- Modify: `src/engine/paodekuai/engine.ts:9-11`
- Test: `src/engine/paodekuai/state.test.ts`

- [ ] **Step 1: 写失败测试**

在 `src/engine/paodekuai/state.test.ts` 末尾 import 行无需改（已 import `createInitialState`）。注意：现有 3 个测试调用 `createInitialState(['p1','p2','p3'], seededRandom(1))` —— 加了第三参后这些调用要补 `'classic16'`。先更新这 3 处调用，再加新 describe。

更新现有 3 处（把每个 `createInitialState(['p1','p2','p3'], seededRandom(1))` 改为 `createInitialState(['p1','p2','p3'], seededRandom(1), 'classic16')`），然后在文件末尾最后一个 `})` 前追加：

```typescript
describe('createInitialState classic15', () => {
  it('3 players each 15 cards, empty kitty', () => {
    const st = createInitialState(['p1','p2','p3'], seededRandom(1), 'classic15')
    expect(st.players).toHaveLength(3)
    for (const p of st.players) expect(p.hand).toHaveLength(15)
    expect(st.kitty).toHaveLength(0)
  })
  it('classic15 first player holds diamond 3', () => {
    const st = createInitialState(['p1','p2','p3'], seededRandom(1), 'classic15')
    const holder = st.players.findIndex((p) => p.hand.some((c) => c.rank==='3' && c.suit==='D'))
    expect(st.currentPlayer).toBe(holder)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `NODE_OPTIONS="--use-bundled-ca" ./node_modules/.bin/vitest run src/engine/paodekuai/state.test.ts`
Expected: FAIL —— `createInitialState` 当前只接受 2 参，调用传 3 参类型/编译报错，或 15 张断言不通过。

- [ ] **Step 3: 改 `state.ts`**

`src/engine/paodekuai/state.ts` 第 4 行 import 当前为 `import { shuffle, deal } from './deck'`。改为：

```typescript
import { shuffle, deal, type DeckVariant } from './deck'
```

并删掉第 3 行 `import { makeFullDeck } from './card'`（不再直接用整副；牌堆改由 `makeDeck` 提供）。

把第 26-37 行的函数改为：

```typescript
export function createInitialState(playerIds: string[], rng: () => number, variant: DeckVariant): GameState {
  const perPlayer = variant === 'classic15' ? 15 : 16
  const { hands, kitty } = deal(shuffle(makeDeck(variant), rng), playerIds.length, perPlayer)
  const players: PlayerState[] = playerIds.map((id, i) => ({
    id, hand: hands[i]!, finishedRank: null,
  }))
  const first = players.findIndex((p) => p.hand.some((c) => c.rank==='3' && c.suit==='D'))
  return {
    players, kitty,
    currentPlayer: first === -1 ? 0 : first,
    lastPlay: null, passesSinceLastPlay: 0, phase: 'PLAYING', finishedCount: 0,
  }
}
```

并在 import 区加入 `makeDeck`：把上面那行改成 `import { shuffle, deal, makeDeck, type DeckVariant } from './deck'`。

- [ ] **Step 4: 改 `engine.ts`**

`src/engine/paodekuai/engine.ts` 第 2 行 import 加 `DeckVariant`：当前是 `import type { GameState } from './state'`，在其下新增 `import type { DeckVariant } from './deck'`。

第 6 行 `implements GameEngine<GameState, PdkAction, PdkEvent>` 改为 `implements GameEngine<GameState, PdkAction, PdkEvent, DeckVariant>`。

第 9-11 行的方法改为：

```typescript
  createInitialState(playerIds: string[], rng: () => number, variant: DeckVariant): GameState {
    return createInitialState(playerIds, rng, variant)
  }
```

- [ ] **Step 5: 跑 state 测试 + 全量 typecheck**

Run: `NODE_OPTIONS="--use-bundled-ca" ./node_modules/.bin/vitest run src/engine/paodekuai/state.test.ts`
Expected: PASS。

Run: `NODE_OPTIONS="--use-bundled-ca" ./node_modules/.bin/tsc --noEmit`
Expected: 仍有 `room/room.ts`、`room/manager.ts` 因 `engine.createInitialState` 调用缺 variant 而报错（Task 4 修复）；engine/state 自身应无错。若 engine/state 仍报错，先修干净再进 Task 4。

- [ ] **Step 6: 提交**

```bash
git add src/engine/paodekuai/state.ts src/engine/paodekuai/engine.ts src/engine/paodekuai/state.test.ts
git commit -m "feat(engine): deal by deck variant in createInitialState"
```

---

## Task 4: Room 持有 variant 并透传

**Files:**
- Modify: `src/room/room.ts:11-20`（RoomDeps）、`src/room/room.ts:200-207`（start）
- Test: `src/room/room.test.ts`

- [ ] **Step 1: 写失败测试**

`src/room/room.test.ts` 的 `makeRoom(transport)` 工厂（约第 13-23 行）构造 `Room` 时传了 7 个字段，无 variant。先给工厂加可选参并默认 16：

把 `function makeRoom(transport: RecordingTransport) {` 改为 `function makeRoom(transport: RecordingTransport, variant: 'classic15' | 'classic16' = 'classic16') {`，并在 `new Room({...})` 的对象里、`turnMs: 30000,` 之后加一行 `variant,`。

然后在文件末尾最后一个 `})` 前追加：

```typescript
describe('Room deck variant', () => {
  it('classic15 deals 15 cards to each seated player', async () => {
    const t = new RecordingTransport()
    const room = makeRoom(t, 'classic15')
    room.enqueue({ type: 'JOIN', playerId: 'p1' })
    room.enqueue({ type: 'JOIN', playerId: 'p2' })
    room.enqueue({ type: 'JOIN', playerId: 'p3' })
    await room.idle()
    const priv = t.sentTo('p1').filter((m) => m.type === 'STATE')
    const last = priv[priv.length - 1]!
    expect((last.payload as { you: { hand: unknown[] } }).you.hand).toHaveLength(15)
  })
})
```

注：`RecordingTransport.sentTo(playerId)` 已存在（`transport.ts:42`），返回该玩家收到的 send 列表；私有 STATE 的 payload 形如 `{ you: { playerId, hand, seat }, others, currentPlayer, lastPlay }`（见 `room.ts:223-231`）。

- [ ] **Step 2: 跑测试确认失败**

Run: `NODE_OPTIONS="--use-bundled-ca" ./node_modules/.bin/vitest run src/room/room.test.ts`
Expected: FAIL —— `Room` 构造对象多了 `variant` 字段但 `RoomDeps` 没声明（类型错误），或 start 仍发 16 张导致断言 15 失败。

- [ ] **Step 3: 改 `RoomDeps` 与 import**

`src/room/room.ts` 顶部 import 区（第 1-9 行附近）加：

```typescript
import type { DeckVariant } from '../engine/paodekuai/deck'
```

`RoomDeps`（第 11-20 行）在 `turnMs: number` 之后加一行：

```typescript
  variant: DeckVariant
```

- [ ] **Step 4: 改 `start()` 透传 variant**

`src/room/room.ts` 第 200-201 行当前为：

```typescript
  private start(): void {
    this.state = this.deps.engine.createInitialState(this.seatOrder, this.deps.rng)
```

把第二行改为：

```typescript
    this.state = this.deps.engine.createInitialState(this.seatOrder, this.deps.rng, this.deps.variant)
```

- [ ] **Step 5: 跑 room 测试**

Run: `NODE_OPTIONS="--use-bundled-ca" ./node_modules/.bin/vitest run src/room/room.test.ts`
Expected: PASS（原有用例 + 新增 classic15）。

- [ ] **Step 6: 提交**

```bash
git add src/room/room.ts src/room/room.test.ts
git commit -m "feat(room): Room carries deck variant into start"
```

---

## Task 5: RoomManager.createRoom 接受 variant

**Files:**
- Modify: `src/room/manager.ts:25-39`（createRoom）、`src/room/manager.ts:50-66`（restoreRoom）
- Test: `src/room/manager.test.ts`

- [ ] **Step 1: 写失败测试**

`src/room/manager.test.ts` 的 `makeManager` 已就绪。在文件末尾最后一个 `})` 前追加：

```typescript
describe('RoomManager deck variant', () => {
  it('createRoom passes variant through so classic15 deals 15 cards', async () => {
    const { mgr, transport } = makeManager()
    const room = mgr.createRoom('r1', 'classic15')
    room.enqueue({ type: 'JOIN', playerId: 'p1' })
    room.enqueue({ type: 'JOIN', playerId: 'p2' })
    room.enqueue({ type: 'JOIN', playerId: 'p3' })
    await room.idle()
    const priv = transport.sentTo('p1').filter((m) => m.type === 'STATE')
    const last = priv[priv.length - 1]!
    expect((last.payload as { you: { hand: unknown[] } }).you.hand).toHaveLength(15)
  })
  it('createRoom defaults to classic16 (16 cards) when variant omitted', async () => {
    const { mgr, transport } = makeManager()
    const room = mgr.createRoom('r1')
    room.enqueue({ type: 'JOIN', playerId: 'p1' })
    room.enqueue({ type: 'JOIN', playerId: 'p2' })
    room.enqueue({ type: 'JOIN', playerId: 'p3' })
    await room.idle()
    const priv = transport.sentTo('p1').filter((m) => m.type === 'STATE')
    const last = priv[priv.length - 1]!
    expect((last.payload as { you: { hand: unknown[] } }).you.hand).toHaveLength(16)
  })
})
```

注：`makeManager` 返回 `{ mgr, transport, store }`，且 `transport` 即 gateway 不在场时的 `RecordingTransport`，`sentTo` 可用。

- [ ] **Step 2: 跑测试确认失败**

Run: `NODE_OPTIONS="--use-bundled-ca" ./node_modules/.bin/vitest run src/room/manager.test.ts`
Expected: FAIL —— `createRoom('r1', 'classic15')` 多传一参，当前 `createRoom(roomId)` 只接受一参（类型错误）。

- [ ] **Step 3: 改 `manager.ts` import 与 createRoom**

`src/room/manager.ts` 顶部 import 区加：

```typescript
import type { DeckVariant } from '../engine/paodekuai/deck'
```

第 25 行 `createRoom(roomId: string): Room {` 改为：

```typescript
  createRoom(roomId: string, variant: DeckVariant = 'classic16'): Room {
```

在该方法内 `new Room({...})` 的对象里、`turnMs: this.deps.turnMs,` 之后加一行：

```typescript
      variant,
```

- [ ] **Step 4: 改 `restoreRoom`（补 variant 字段）**

`restoreRoom`（第 50-66 行）内也 `new Room({...})`。重建的房间从快照灌入已发好的牌、不再调 `start()`，variant 不影响行为，但 `RoomDeps.variant` 现为必填，须给值。在其 `new Room({...})` 对象里 `turnMs: this.deps.turnMs,` 之后加一行：

```typescript
      variant: 'classic16',
```

并在该行上方加一行注释：

```typescript
      // 重建房间从快照恢复已发牌局，不重新发牌；variant 在此不参与，仅占位满足类型。
```

- [ ] **Step 5: 跑 manager 测试 + 全量 typecheck**

Run: `NODE_OPTIONS="--use-bundled-ca" ./node_modules/.bin/vitest run src/room/manager.test.ts`
Expected: PASS。

Run: `NODE_OPTIONS="--use-bundled-ca" ./node_modules/.bin/tsc --noEmit`
Expected: PASS（engine/state/room/manager 链路至此类型自洽；gateway 调 createRoom 仍只传 roomId，因 variant 有默认值，不报错）。

- [ ] **Step 6: 提交**

```bash
git add src/room/manager.ts src/room/manager.test.ts
git commit -m "feat(room): createRoom accepts deck variant, defaults classic16"
```

---

## Task 6: 协议解析 CREATE 的 variant

**Files:**
- Modify: `src/gateway/protocol.ts:4-11`（ClientMessage）、`src/gateway/protocol.ts:37-42`（CREATE/JOIN 分支）
- Test: `src/gateway/protocol.test.ts`（若不存在则创建）

`ClientMessage` 当前 CREATE 与 JOIN 共用 `{ type; roomId }`（`protocol.ts:5-6`），且解析时 `case 'CREATE': case 'JOIN':` 合并（第 37-42 行）。本任务给 CREATE 单独加 `variant`，JOIN 保持不变。

- [ ] **Step 1: 确认/创建测试文件**

先看 `src/gateway/protocol.test.ts` 是否存在：

Run: `ls src/gateway/protocol.test.ts 2>/dev/null || echo NONE`

若输出 `NONE`，创建该文件，内容：

```typescript
import { describe, it, expect } from 'vitest'
import { parseClientMessage } from './protocol'

describe('parseClientMessage CREATE variant', () => {
  it('passes through classic15', () => {
    const r = parseClientMessage(JSON.stringify({ type: 'CREATE', payload: { roomId: 'r1', variant: 'classic15' } }))
    expect(r.ok).toBe(true)
    if (r.ok && r.msg.type === 'CREATE') expect(r.msg.variant).toBe('classic15')
  })
  it('defaults to classic16 when variant omitted', () => {
    const r = parseClientMessage(JSON.stringify({ type: 'CREATE', payload: { roomId: 'r1' } }))
    expect(r.ok).toBe(true)
    if (r.ok && r.msg.type === 'CREATE') expect(r.msg.variant).toBe('classic16')
  })
  it('falls back to classic16 on invalid variant', () => {
    const r = parseClientMessage(JSON.stringify({ type: 'CREATE', payload: { roomId: 'r1', variant: 'bogus' } }))
    expect(r.ok).toBe(true)
    if (r.ok && r.msg.type === 'CREATE') expect(r.msg.variant).toBe('classic16')
  })
})
```

若文件已存在，则把上面这个 `describe` 块追加到末尾，并确保顶部已 import `parseClientMessage`。

- [ ] **Step 2: 跑测试确认失败**

Run: `NODE_OPTIONS="--use-bundled-ca" ./node_modules/.bin/vitest run src/gateway/protocol.test.ts`
Expected: FAIL —— CREATE 的 msg 上无 `variant` 字段（类型错误或 undefined）。

- [ ] **Step 3: 改 `ClientMessage` 类型**

`src/gateway/protocol.ts` 顶部 import 区（第 1 行 `import type { Card } ...` 附近）加：

```typescript
import type { DeckVariant } from '../engine/paodekuai/deck'
```

把第 4-9 行的联合类型中 CREATE 与 JOIN 拆开（当前两者都是 `{ type: 'CREATE'/'JOIN'; roomId: string }`）：

```typescript
export type ClientMessage =
  | { type: 'AUTH'; code: string }
  | { type: 'CREATE'; roomId: string; variant: DeckVariant }
  | { type: 'JOIN'; roomId: string }
  | { type: 'PLAY'; cards: Card[] }
  | { type: 'PASS' }
  | { type: 'RESUME' }
```

- [ ] **Step 4: 改解析逻辑（拆分 CREATE / JOIN）**

`src/gateway/protocol.ts` 第 37-42 行当前为：

```typescript
    case 'CREATE':
    case 'JOIN': {
      const roomId = payload['roomId']
      if (typeof roomId !== 'string') return { ok: false, reason: 'BAD_MESSAGE' }
      return { ok: true, msg: { type, roomId } }
    }
```

替换为：

```typescript
    case 'CREATE': {
      const roomId = payload['roomId']
      if (typeof roomId !== 'string') return { ok: false, reason: 'BAD_MESSAGE' }
      const raw = payload['variant']
      const variant: DeckVariant = raw === 'classic15' ? 'classic15' : 'classic16'
      return { ok: true, msg: { type: 'CREATE', roomId, variant } }
    }
    case 'JOIN': {
      const roomId = payload['roomId']
      if (typeof roomId !== 'string') return { ok: false, reason: 'BAD_MESSAGE' }
      return { ok: true, msg: { type: 'JOIN', roomId } }
    }
```

- [ ] **Step 5: 跑协议测试**

Run: `NODE_OPTIONS="--use-bundled-ca" ./node_modules/.bin/vitest run src/gateway/protocol.test.ts`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add src/gateway/protocol.ts src/gateway/protocol.test.ts
git commit -m "feat(gateway): parse CREATE variant, lenient fallback to classic16"
```

---

## Task 7: gateway 路由 — CREATE 透传 variant、JOIN 空房拒

**Files:**
- Modify: `src/gateway/gateway.ts:89-100`（CREATE/JOIN case）
- Test: `src/gateway/gateway.test.ts`

`gateway.ts` 第 90-100 行当前 `case 'CREATE': case 'JOIN':` 合并，统一 `getRoom(msg.roomId) ?? createRoom(msg.roomId)`。本任务拆开：CREATE 透传 variant、JOIN 空房直接拒 `ROOM_NOT_FOUND`。

- [ ] **Step 1: 写失败测试**

在 `src/gateway/gateway.test.ts` 末尾最后一个 `})` 前追加。`makeGateway()`、`lastMsg(s, type)` 已就绪。

```typescript
describe('WsGateway deck variant and JOIN guard', () => {
  it('CREATE with classic15 starts a 15-card game', async () => {
    const { gateway } = makeGateway()
    const socks: FakeSocket[] = []
    const ids = ['p1', 'p2', 'p3']
    for (const id of ids) {
      const s = new FakeSocket()
      gateway.handleConnection(s)
      s.receive(JSON.stringify({ type: 'AUTH', payload: { code: id } }))
      const verb = id === 'p1' ? 'CREATE' : 'JOIN'
      const payload = id === 'p1' ? { roomId: 'r1', variant: 'classic15' } : { roomId: 'r1' }
      s.receive(JSON.stringify({ type: verb, payload }))
      socks.push(s)
    }
    await gateway.idle()
    const priv = socks[0]!.sent.map((t) => JSON.parse(t) as ServerMessage).filter((m) => m.type === 'STATE' && (m.payload as { you?: unknown }).you)
    const last = priv[priv.length - 1]!
    expect((last.payload as { you: { hand: unknown[] } }).you.hand).toHaveLength(15)
  })

  it('JOIN a non-existent room is rejected with ROOM_NOT_FOUND', async () => {
    const { gateway } = makeGateway()
    const s = new FakeSocket()
    gateway.handleConnection(s)
    s.receive(JSON.stringify({ type: 'AUTH', payload: { code: 'p1' } }))
    s.receive(JSON.stringify({ type: 'JOIN', payload: { roomId: 'ghost' } }))
    await gateway.idle()
    const rej = lastMsg(s, 'REJECTED')
    expect((rej?.payload as { reason: string }).reason).toBe('ROOM_NOT_FOUND')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `NODE_OPTIONS="--use-bundled-ca" ./node_modules/.bin/vitest run src/gateway/gateway.test.ts`
Expected: FAIL —— CREATE 未透传 variant（开局 16 张，断言 15 失败）；JOIN 空房当前会自动建房并开始排队，不会回 `ROOM_NOT_FOUND`。

- [ ] **Step 3: 拆分 CREATE / JOIN 路由**

`src/gateway/gateway.ts` 第 90-100 行当前为：

```typescript
      case 'CREATE':
      case 'JOIN': {
        const room = this.manager!.getRoom(msg.roomId) ?? this.manager!.createRoom(msg.roomId)
        const verdict = room.canJoin(playerId)
        if (!verdict.ok) return this.sendTo(socket, this.reject(verdict.reason))
        this.registry.joinRoom(playerId, msg.roomId)
        info.state = 'IN_ROOM'
        room.enqueue({ type: 'JOIN', playerId })
        await room.idle()
        return
      }
```

替换为：

```typescript
      case 'CREATE': {
        const room = this.manager!.getRoom(msg.roomId) ?? this.manager!.createRoom(msg.roomId, msg.variant)
        const verdict = room.canJoin(playerId)
        if (!verdict.ok) return this.sendTo(socket, this.reject(verdict.reason))
        this.registry.joinRoom(playerId, msg.roomId)
        info.state = 'IN_ROOM'
        room.enqueue({ type: 'JOIN', playerId })
        await room.idle()
        return
      }
      case 'JOIN': {
        const room = this.manager!.getRoom(msg.roomId)
        if (!room) return this.sendTo(socket, this.reject('ROOM_NOT_FOUND'))
        const verdict = room.canJoin(playerId)
        if (!verdict.ok) return this.sendTo(socket, this.reject(verdict.reason))
        this.registry.joinRoom(playerId, msg.roomId)
        info.state = 'IN_ROOM'
        room.enqueue({ type: 'JOIN', playerId })
        await room.idle()
        return
      }
```

- [ ] **Step 4: 跑 gateway 测试**

Run: `NODE_OPTIONS="--use-bundled-ca" ./node_modules/.bin/vitest run src/gateway/gateway.test.ts`
Expected: PASS。若有原有测试因 JOIN-空房旧行为失败，检查该测试是否让首个玩家用 JOIN 而非 CREATE 建房——按 spec，建房必须经 CREATE；把该测试首个动作改为 CREATE 即可（gateway.test 现有 line 58/93/116 系列首个动作已是 CREATE，预期不受影响）。

- [ ] **Step 5: 全量测试 + typecheck**

Run: `NODE_OPTIONS="--use-bundled-ca" ./node_modules/.bin/vitest run`
Expected: 全绿（原 115 + 本次新增）。

Run: `NODE_OPTIONS="--use-bundled-ca" ./node_modules/.bin/tsc --noEmit`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add src/gateway/gateway.ts src/gateway/gateway.test.ts
git commit -m "feat(gateway): route CREATE variant, reject JOIN to missing room"
```

---

## Task 8: 端到端验证加 classic15 轮次

**Files:**
- Modify: `scripts/e2e-smoke.mjs`

现有 `e2e-smoke.mjs` 起真服务、3 连接走完一局 16 张到 GAME_OVER。本任务把它参数化，先跑 classic16、再跑 classic15，两轮都验证手牌张数与 GAME_OVER。

- [ ] **Step 1: 改脚本支持指定 variant 与手牌断言**

把 `scripts/e2e-smoke.mjs` 改为导出一个 `runGame(variant, expectedHand)` 异步函数并顺序跑两轮。核心改动：

1. CREATE 消息带 variant：在 `makeClient` 的 `AUTHED` 分支，首个玩家发 `{ type: 'CREATE', payload: { roomId: ROOM, variant } }`（`variant` 由外层传入）。
2. 收到第一份私有 STATE 时断言 `you.hand.length === expectedHand`，不符则 `fail`。
3. 用不同 ROOM id 跑两轮（避免房间复用），第一轮 `classic16`/16，第二轮 `classic15`/15，都要走到 GAME_OVER 且三方 ranking 一致。

完整替换文件内容为：

```javascript
// 一次性端到端验证：起真服务（StubAuth + 内存 store），3 个真 WebSocket
// 连接走 AUTH → CREATE/JOIN → 发牌 → 自动逐张 PLAY（被拒则 PASS）直到 GAME_OVER。
// 两轮：classic16（各 16 张）、classic15（各 15 张）。
// 跑：NODE_OPTIONS="--use-bundled-ca" ./node_modules/.bin/tsx scripts/e2e-smoke.mjs
// 跑通即退（exit 0），任何异常或超时 exit 1。

import { WebSocket } from 'ws'
import { loadConfig } from '../src/config.ts'
import { createServer } from '../src/composition.ts'

const PORT = 8123
const PLAYERS = ['alice', 'bob', 'carol']
const rankValue = (r) =>
  ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'].indexOf(r)

function fail(msg) {
  console.error(`[e2e] FAIL: ${msg}`)
  process.exit(1)
}
const log = (...a) => console.log('[e2e]', ...a)

const config = loadConfig({ ...process.env, PORT: String(PORT), TURN_MS: '60000' })
const server = createServer(config)
log(`server listening on :${PORT}`)

function runGame(variant, expectedHand, roomId) {
  return new Promise((resolve) => {
    let gameOverSeen = false
    const rankingByPlayer = new Map()
    const watchdog = setTimeout(() => fail(`[${variant}] timed out, no GAME_OVER within 30s`), 30000)

    function makeClient(playerId) {
      const ws = new WebSocket(`ws://127.0.0.1:${PORT}`)
      const state = { playerId, hand: [], myTurn: false, finished: false, sawHand: false }
      const send = (obj) => ws.send(JSON.stringify(obj))

      function act() {
        if (!state.myTurn || state.finished || state.hand.length === 0) return
        const sorted = [...state.hand].sort((a, b) => rankValue(a.rank) - rankValue(b.rank))
        send({ type: 'PLAY', payload: { cards: [sorted[0]] } })
      }

      ws.on('open', () => send({ type: 'AUTH', payload: { code: playerId } }))
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString())
        switch (msg.type) {
          case 'AUTHED': {
            if (msg.payload.playerId !== playerId) fail(`AUTHED wrong id: ${msg.payload.playerId}`)
            if (playerId === PLAYERS[0]) send({ type: 'CREATE', payload: { roomId, variant } })
            else send({ type: 'JOIN', payload: { roomId } })
            return
          }
          case 'STATE': {
            if (msg.payload.you) {
              state.hand = msg.payload.you.hand
              if (!state.sawHand) {
                state.sawHand = true
                if (state.hand.length !== expectedHand)
                  fail(`[${variant}] ${playerId} dealt ${state.hand.length}, expected ${expectedHand}`)
              }
              const seat = msg.payload.you.seat
              state.myTurn = msg.payload.currentPlayer === seat
              if (state.myTurn) act()
            }
            return
          }
          case 'REJECTED': {
            if (state.myTurn && msg.payload.reason !== 'NOT_YOUR_TURN') send({ type: 'PASS', payload: {} })
            return
          }
          case 'GAME_OVER': {
            if (!gameOverSeen) {
              gameOverSeen = true
              log(`[${variant}] GAME_OVER ranking:`, JSON.stringify(msg.payload.ranking))
            }
            rankingByPlayer.set(playerId, msg.payload.ranking)
            state.finished = true
            ws.close()
            return
          }
        }
      })
      ws.on('error', (e) => fail(`[${variant}] ws error for ${playerId}: ${e.message}`))
    }

    PLAYERS.forEach((p, i) => setTimeout(() => makeClient(p), i * 150))

    const poll = setInterval(() => {
      if (!gameOverSeen || rankingByPlayer.size < PLAYERS.length) return
      clearInterval(poll)
      clearTimeout(watchdog)
      const rankings = [...rankingByPlayer.values()]
      const first = JSON.stringify(rankings[0])
      for (const r of rankings) if (JSON.stringify(r) !== first) fail(`[${variant}] rankings diverge`)
      const ranked = new Set(rankings[0].map((x) => x.playerId))
      for (const p of PLAYERS) if (!ranked.has(p)) fail(`[${variant}] ${p} missing from ranking`)
      log(`[${variant}] OK: 3 players agree, ${expectedHand}-card game played end-to-end`)
      resolve()
    }, 100)
  })
}

const run = async () => {
  await runGame('classic16', 16, 'room16')
  await runGame('classic15', 15, 'room15')
  await server.shutdown()
  log('server shutdown complete')
  process.exit(0)
}
run()
```

- [ ] **Step 2: 跑端到端**

Run: `NODE_OPTIONS="--use-bundled-ca" ./node_modules/.bin/tsx scripts/e2e-smoke.mjs`
Expected: 输出两轮 `[classic16] OK: ... 16-card` 和 `[classic15] OK: ... 15-card`，最后 `server shutdown complete`，exit 0。

- [ ] **Step 3: 提交**

```bash
git add scripts/e2e-smoke.mjs
git commit -m "test(e2e): verify both classic16 and classic15 games end-to-end"
```

---

## 收尾

全部 8 个任务完成后：

- [ ] 跑全量回归：`NODE_OPTIONS="--use-bundled-ca" ./node_modules/.bin/vitest run`（全绿）+ `tsc --noEmit`（PASS）。
- [ ] 用 superpowers:finishing-a-development-branch 收尾（推送/PR 等由用户选）。

## 备注

- `combo.ts`/`rules.ts` 全程不动：规则在两玩法间一致；15 张玩法里 2/A 各 1 张、K 3 张，玩家天然凑不齐 4 张同点，炸弹自然不出现，无需特判。
- `composition.ts`/`main.ts` 不动：createServer 不感知玩法，玩法只在运行期由 CREATE 消息驱动。
- `restoreRoom` 的 `variant: 'classic16'` 是占位：重建房间从快照恢复已发牌局、不再 `start()`，该值不参与发牌。
