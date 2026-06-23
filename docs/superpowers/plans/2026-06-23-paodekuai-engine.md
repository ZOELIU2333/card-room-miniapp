# 跑得快游戏引擎 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现一个纯逻辑、零 IO、可单测的「跑得快」游戏引擎，并通过一个与玩法无关的 `GameEngine` 契约把它和未来的房间/网络层隔开，为后续接入 N 个牌类玩法打好地基。

**Architecture:** 分两层。`contract.ts` 定义与玩法无关的 `GameEngine<S,A,E>` 契约（纯函数状态机、随机源外部注入、服务端权威）。`paodekuai/` 是该契约的第一个实现，所有跑得快规则封闭在内。房间层将来只依赖契约，永不认识"跑得快"。性能瓶颈在网络层而非引擎，扩展靠房间分片而非改引擎——见 [TECH_DESIGN.md](../../TECH_DESIGN.md)。

**Tech Stack:** Node.js v24 + TypeScript（ESM）、Vitest 测试、无运行时依赖。

---

## 设计决策记录

- **接口契约隔离**：现在只做一个玩法，但用 `GameEngine<S,A,E>` 把接缝切在正确位置。不预造牌型注册表/规则插件等多玩法框架——等第二个玩法出现，用两个真实样本提炼公共抽象（三次法则）。
- **`step` 留系统/超时动作口子**：动作类型里允许一种由房间层计时器触发的系统动作（跑得快暂不用，但麻将的"碰杠胡决策窗口"需要）。契约不为此改签名，仅在约定上预留。
- **`ranking` 带 score**：返回 `{ playerId, rank, score }`，score 含义由各玩法定义（跑得快=负的剩牌数），房间/持久层只落库不解释，为积分体系留出信息。
- **不可变状态**：每次 `step` 返回新 state，换取可测性与断线重建能力；数据量级小，开销可忽略。

## 跑得快规则边界（本计划实现范围）

主流 3 人 / 16 张版本，第一版固定规则，不做可配置：

- **牌组**：标准 52 张去王。3 人各 16 张，余 4 张入牌堆底（kitty）。
- **牌力**：3 < 4 < 5 < 6 < 7 < 8 < 9 < 10 < J < Q < K < A < 2，花色不影响牌力。
- **首出**：持方块3 者首出。
- **牌型**：单张 `SINGLE`、对子 `PAIR`、三张 `TRIPLE`、三带一 `TRIPLE_SINGLE`、顺子 `STRAIGHT`（≥5 张连续，2 不入顺）、炸弹 `BOMB`（四张同点）。
- **比牌**：跟牌须同型同张数且更大；顺子须同长度；炸弹压任意非炸弹；大炸弹压小炸弹。
- **过牌**：非首家可 `PASS`；一圈内除最后出牌者外全 PASS 则清台，最后出牌者获新首出权。
- **胜负**：第一个出完者为冠军，产出 `GAME_OVER`，按名次 + 剩牌数排名（积分在持久层算）。

不在范围：癞子、连对、飞机、四带二、分数结算、15 张变体、麻将类。

---

## File Structure

```
server/src/engine/
  contract.ts                          # 与玩法无关的 GameEngine 契约
  contract.test.ts                     # 契约的可替换性测试（用接口类型持有实现）
  paodekuai/
    card.ts / card.test.ts             # 牌表示、牌力、整副牌
    deck.ts / deck.test.ts             # 可注入随机源的洗牌发牌
    combo.ts / combo.test.ts ...       # 牌型识别 + 压牌判定
    state.ts / state.test.ts           # 跑得快状态类型 + 初始化
    rules.ts / *.test.ts               # 纯规则：处理一个动作 → 新状态 + 事件
    engine.ts                          # PaodekuaiEngine implements GameEngine
    index.ts                           # 对外导出
```

工程配置：`server/package.json`、`server/tsconfig.json`、`server/vitest.config.ts`。

`rules.ts` 与 `engine.ts` 分开：`rules.ts` 是无状态纯函数集合（出牌/过牌如何改状态），`engine.ts` 把它们组装成实现契约的类。这样核心规则可独立测试，契约适配层很薄。

---

## Task 0: 初始化 server 工程

**Files:**
- Create: `server/package.json`, `server/tsconfig.json`, `server/vitest.config.ts`, `server/.gitignore`

- [ ] **Step 1: package.json**

```json
{
  "name": "card-room-server",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "@types/node": "^22.0.0"
  }
}
```

- [ ] **Step 2: tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "verbatimModuleSyntax": true,
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
})
```

- [ ] **Step 4: .gitignore**

```
node_modules/
dist/
```

- [ ] **Step 5: 安装并验证**

Run: `cd server && npm install && npm run typecheck`
Expected: 安装成功；typecheck 无错误（src 为空）。

- [ ] **Step 6: Commit**

```bash
git add server/package.json server/tsconfig.json server/vitest.config.ts server/.gitignore
git commit -m "chore: init server workspace with typescript + vitest"
```

---

## Task 1: 与玩法无关的引擎契约（contract.ts）

**Files:**
- Create: `server/src/engine/contract.ts`

本任务只定义类型契约，无运行逻辑，故无独立测试——可替换性在 Task 8 用 PaodekuaiEngine 验证。

- [ ] **Step 1: 实现 contract.ts**

```typescript
// 引擎一步产出：新状态 + 本步事件。纯函数，无 IO。
export interface StepResult<S, E> {
  state: S
  events: E[]
}

// 名次条目。score 含义由各玩法定义（如跑得快=负的剩牌数、麻将=番数），
// 房间/持久层只负责落库，不解释含义。
export interface RankEntry {
  playerId: string
  rank: number   // 1 为冠军
  score: number
}

/**
 * 所有牌类玩法引擎实现的契约。S/A/E 由各玩法自定义。
 *
 * 约定：
 * - step 是纯函数，不得触碰网络/存储/时间/随机。随机性只能经
 *   createInitialState 注入的 rng 进入。
 * - 动作类型 A 允许包含一种"系统/超时"动作（由房间层计时器触发），
 *   用于表达"等待外部响应窗口"（如麻将碰杠胡）。跑得快暂不使用，
 *   但契约据此约定，未来玩法无需改签名。
 * - 服务端权威：客户端只发意图，合法性与结果一律由 step 判定。
 */
export interface GameEngine<S, A, E> {
  readonly kind: string
  createInitialState(playerIds: string[], rng: () => number): S
  step(state: S, action: A): StepResult<S, E>
  isFinished(state: S): boolean
  ranking(state: S): RankEntry[]
}
```

- [ ] **Step 2: 类型检查**

Run: `cd server && npm run typecheck`
Expected: 无错误。

- [ ] **Step 3: Commit**

```bash
git add server/src/engine/contract.ts
git commit -m "feat(engine): game-agnostic GameEngine contract"
```

---

## Task 2: 牌的表示与牌力（card.ts）

**Files:**
- Create: `server/src/engine/paodekuai/card.ts`
- Test: `server/src/engine/paodekuai/card.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
import { describe, it, expect } from 'vitest'
import { makeFullDeck, rankValue, type Card } from './card'

describe('card', () => {
  it('full deck has 52 unique cards (no jokers)', () => {
    const deck = makeFullDeck()
    expect(deck).toHaveLength(52)
    expect(new Set(deck.map((c) => c.id)).size).toBe(52)
  })
  it('rank ordering: 3 lowest, 2 highest', () => {
    expect(rankValue('3')).toBeLessThan(rankValue('4'))
    expect(rankValue('A')).toBeLessThan(rankValue('2'))
    expect(rankValue('K')).toBeLessThan(rankValue('A'))
  })
  it('deck contains diamond 3', () => {
    const c: Card = { rank: '3', suit: 'D' }
    expect(makeFullDeck().some((x) => x.rank === c.rank && x.suit === c.suit)).toBe(true)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd server && npx vitest run src/engine/paodekuai/card.test.ts`
Expected: FAIL — 模块/导出未定义。

- [ ] **Step 3: 实现 card.ts**

```typescript
export type Rank =
  | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A' | '2'
export type Suit = 'C' | 'D' | 'H' | 'S'

export interface Card { rank: Rank; suit: Suit }

const RANK_ORDER: Rank[] = ['3','4','5','6','7','8','9','10','J','Q','K','A','2']

export function rankValue(rank: Rank): number {
  return RANK_ORDER.indexOf(rank)
}

export function cardId(card: Card): string {
  return `${card.suit}${card.rank}`
}

export function makeFullDeck(): Array<Card & { id: string }> {
  const suits: Suit[] = ['C', 'D', 'H', 'S']
  const deck: Array<Card & { id: string }> = []
  for (const suit of suits)
    for (const rank of RANK_ORDER)
      deck.push({ rank, suit, id: `${suit}${rank}` })
  return deck
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd server && npx vitest run src/engine/paodekuai/card.test.ts`
Expected: PASS（3 用例）。

- [ ] **Step 5: Commit**

```bash
git add server/src/engine/paodekuai/card.ts server/src/engine/paodekuai/card.test.ts
git commit -m "feat(engine): card representation and rank ordering"
```

---

## Task 3: 可复现洗牌与发牌（deck.ts）

**Files:**
- Create: `server/src/engine/paodekuai/deck.ts`
- Test: `server/src/engine/paodekuai/deck.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
import { describe, it, expect } from 'vitest'
import { shuffle, deal } from './deck'
import { makeFullDeck } from './card'

function seededRandom(seed: number): () => number {
  let s = seed >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0xffffffff }
}

describe('deck', () => {
  it('shuffle deterministic given same seed', () => {
    const a = shuffle(makeFullDeck(), seededRandom(42))
    const b = shuffle(makeFullDeck(), seededRandom(42))
    expect(a.map((c) => c.id)).toEqual(b.map((c) => c.id))
  })
  it('shuffle preserves all 52 cards', () => {
    expect(new Set(shuffle(makeFullDeck(), seededRandom(7)).map((c) => c.id)).size).toBe(52)
  })
  it('deal: 3 players 16 each, 4 in kitty', () => {
    const { hands, kitty } = deal(shuffle(makeFullDeck(), seededRandom(1)), 3, 16)
    expect(hands).toHaveLength(3)
    for (const h of hands) expect(h).toHaveLength(16)
    expect(kitty).toHaveLength(4)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd server && npx vitest run src/engine/paodekuai/deck.test.ts`
Expected: FAIL — shuffle/deal 未定义。

- [ ] **Step 3: 实现 deck.ts**

```typescript
import type { Card } from './card'

type CardWithId = Card & { id: string }

export function shuffle(deck: CardWithId[], rng: () => number): CardWithId[] {
  const out = [...deck]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = out[i]!; out[i] = out[j]!; out[j] = tmp
  }
  return out
}

export function deal(
  deck: CardWithId[], players: number, perPlayer: number,
): { hands: CardWithId[][]; kitty: CardWithId[] } {
  const hands: CardWithId[][] = Array.from({ length: players }, () => [])
  let idx = 0
  for (let n = 0; n < perPlayer; n++)
    for (let p = 0; p < players; p++) { hands[p]!.push(deck[idx]!); idx++ }
  return { hands, kitty: deck.slice(idx) }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd server && npx vitest run src/engine/paodekuai/deck.test.ts`
Expected: PASS（3 用例）。

- [ ] **Step 5: Commit**

```bash
git add server/src/engine/paodekuai/deck.ts server/src/engine/paodekuai/deck.test.ts
git commit -m "feat(engine): deterministic shuffle and deal"
```

---

## Task 4: 牌型识别（combo.ts — identifyCombo）

**Files:**
- Create: `server/src/engine/paodekuai/combo.ts`
- Test: `server/src/engine/paodekuai/combo.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
import { describe, it, expect } from 'vitest'
import { identifyCombo } from './combo'
import type { Card } from './card'

const c = (rank: Card['rank'], suit: Card['suit'] = 'C'): Card => ({ rank, suit })

describe('identifyCombo', () => {
  it('single', () => { expect(identifyCombo([c('5')])).toMatchObject({ type: 'SINGLE' }) })
  it('pair', () => { expect(identifyCombo([c('7','C'),c('7','D')])).toMatchObject({ type: 'PAIR' }) })
  it('non-pair two cards invalid', () => { expect(identifyCombo([c('7'),c('8')])).toBeNull() })
  it('triple', () => { expect(identifyCombo([c('9','C'),c('9','D'),c('9','H')])).toMatchObject({ type: 'TRIPLE' }) })
  it('triple+single', () => { expect(identifyCombo([c('9','C'),c('9','D'),c('9','H'),c('4')])).toMatchObject({ type: 'TRIPLE_SINGLE' }) })
  it('straight of 5', () => { expect(identifyCombo([c('3'),c('4'),c('5'),c('6'),c('7')])).toMatchObject({ type: 'STRAIGHT' }) })
  it('straight cannot include 2', () => { expect(identifyCombo([c('J'),c('Q'),c('K'),c('A'),c('2')])).toBeNull() })
  it('bomb', () => { expect(identifyCombo([c('5','C'),c('5','D'),c('5','H'),c('5','S')])).toMatchObject({ type: 'BOMB' }) })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd server && npx vitest run src/engine/paodekuai/combo.test.ts`
Expected: FAIL — identifyCombo 未定义。

- [ ] **Step 3: 实现 combo.ts 的 identifyCombo**

```typescript
import { rankValue, type Card, type Rank } from './card'

export type ComboType = 'SINGLE' | 'PAIR' | 'TRIPLE' | 'TRIPLE_SINGLE' | 'STRAIGHT' | 'BOMB'

export interface Combo {
  type: ComboType
  power: number   // 同型比大小用的主牌力
  length: number  // 张数（顺子比较用）
  cards: Card[]
}

function countByRank(cards: Card[]): Map<Rank, number> {
  const m = new Map<Rank, number>()
  for (const c of cards) m.set(c.rank, (m.get(c.rank) ?? 0) + 1)
  return m
}

function isConsecutive(ranks: Rank[]): boolean {
  if (ranks.includes('2')) return false
  const vals = ranks.map(rankValue).sort((a, b) => a - b)
  for (let i = 1; i < vals.length; i++)
    if (vals[i]! !== vals[i - 1]! + 1) return false
  return true
}

export function identifyCombo(cards: Card[]): Combo | null {
  if (cards.length === 0) return null
  const counts = countByRank(cards)
  const ranks = [...counts.keys()]

  if (cards.length === 4 && counts.size === 1)
    return { type: 'BOMB', power: rankValue(ranks[0]!), length: 4, cards }
  if (cards.length === 1)
    return { type: 'SINGLE', power: rankValue(cards[0]!.rank), length: 1, cards }
  if (cards.length === 2 && counts.size === 1)
    return { type: 'PAIR', power: rankValue(ranks[0]!), length: 2, cards }
  if (cards.length === 3 && counts.size === 1)
    return { type: 'TRIPLE', power: rankValue(ranks[0]!), length: 3, cards }
  if (cards.length === 4 && counts.size === 2) {
    const triple = ranks.find((r) => counts.get(r) === 3)
    const single = ranks.find((r) => counts.get(r) === 1)
    if (triple && single)
      return { type: 'TRIPLE_SINGLE', power: rankValue(triple), length: 4, cards }
    return null
  }
  if (cards.length >= 5 && counts.size === cards.length && isConsecutive(ranks)) {
    const maxVal = Math.max(...ranks.map(rankValue))
    return { type: 'STRAIGHT', power: maxVal, length: cards.length, cards }
  }
  return null
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd server && npx vitest run src/engine/paodekuai/combo.test.ts`
Expected: PASS（8 用例）。

- [ ] **Step 5: Commit**

```bash
git add server/src/engine/paodekuai/combo.ts server/src/engine/paodekuai/combo.test.ts
git commit -m "feat(engine): combo identification"
```

---

## Task 5: 压牌判定（combo.ts — canBeat）

**Files:**
- Modify: `server/src/engine/paodekuai/combo.ts`（追加 canBeat）
- Test: `server/src/engine/paodekuai/combo-beat.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
import { describe, it, expect } from 'vitest'
import { identifyCombo, canBeat } from './combo'
import type { Card } from './card'

const c = (rank: Card['rank'], suit: Card['suit'] = 'C'): Card => ({ rank, suit })
const combo = (cards: Card[]) => identifyCombo(cards)!

describe('canBeat', () => {
  it('higher single beats lower', () => {
    expect(canBeat(combo([c('8')]), combo([c('5')]))).toBe(true)
    expect(canBeat(combo([c('5')]), combo([c('8')]))).toBe(false)
  })
  it('different non-bomb type cannot beat', () => {
    expect(canBeat(combo([c('5','C'),c('5','D')]), combo([c('9')]))).toBe(false)
  })
  it('straight must match length', () => {
    const s5 = combo([c('3'),c('4'),c('5'),c('6'),c('7')])
    const s6 = combo([c('3'),c('4'),c('5'),c('6'),c('7'),c('8')])
    expect(canBeat(s6, s5)).toBe(false)
  })
  it('bomb beats non-bomb', () => {
    const bomb = combo([c('5','C'),c('5','D'),c('5','H'),c('5','S')])
    expect(canBeat(bomb, combo([c('2')]))).toBe(true)
  })
  it('bigger bomb beats smaller', () => {
    const b5 = combo([c('5','C'),c('5','D'),c('5','H'),c('5','S')])
    const b9 = combo([c('9','C'),c('9','D'),c('9','H'),c('9','S')])
    expect(canBeat(b9, b5)).toBe(true)
    expect(canBeat(b5, b9)).toBe(false)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd server && npx vitest run src/engine/paodekuai/combo-beat.test.ts`
Expected: FAIL — canBeat 未定义。

- [ ] **Step 3: 在 combo.ts 末尾追加 canBeat**

```typescript
export function canBeat(candidate: Combo, target: Combo): boolean {
  if (candidate.type === 'BOMB' && target.type !== 'BOMB') return true
  if (candidate.type !== 'BOMB' && target.type === 'BOMB') return false
  if (candidate.type === 'BOMB' && target.type === 'BOMB')
    return candidate.power > target.power
  if (candidate.type !== target.type) return false
  if (candidate.type === 'STRAIGHT' && candidate.length !== target.length) return false
  return candidate.power > target.power
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd server && npx vitest run src/engine/paodekuai/combo-beat.test.ts`
Expected: PASS（5 用例）。

- [ ] **Step 5: Commit**

```bash
git add server/src/engine/paodekuai/combo.ts server/src/engine/paodekuai/combo-beat.test.ts
git commit -m "feat(engine): canBeat comparison rules"
```

---

## Task 6: 状态类型与初始化（state.ts）

**Files:**
- Create: `server/src/engine/paodekuai/state.ts`
- Test: `server/src/engine/paodekuai/state.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
import { describe, it, expect } from 'vitest'
import { createInitialState } from './state'

function seededRandom(seed: number): () => number {
  let s = seed >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0xffffffff }
}

describe('createInitialState', () => {
  it('3 players each 16 cards, 4 in kitty', () => {
    const st = createInitialState(['p1','p2','p3'], seededRandom(1))
    expect(st.players).toHaveLength(3)
    for (const p of st.players) expect(p.hand).toHaveLength(16)
    expect(st.kitty).toHaveLength(4)
  })
  it('first player holds diamond 3', () => {
    const st = createInitialState(['p1','p2','p3'], seededRandom(1))
    const holder = st.players.findIndex((p) => p.hand.some((c) => c.rank==='3' && c.suit==='D'))
    expect(st.currentPlayer).toBe(holder)
  })
  it('starts PLAYING with empty table', () => {
    const st = createInitialState(['p1','p2','p3'], seededRandom(1))
    expect(st.phase).toBe('PLAYING')
    expect(st.lastPlay).toBeNull()
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd server && npx vitest run src/engine/paodekuai/state.test.ts`
Expected: FAIL — createInitialState 未定义。

- [ ] **Step 3: 实现 state.ts**

```typescript
import type { Card } from './card'
import type { Combo } from './combo'
import { makeFullDeck } from './card'
import { shuffle, deal } from './deck'

export type Phase = 'PLAYING' | 'FINISHED'

export interface PlayerState {
  id: string
  hand: Card[]
  finishedRank: number | null
}

export interface LastPlay { playerIndex: number; combo: Combo }

export interface GameState {
  players: PlayerState[]
  kitty: Card[]
  currentPlayer: number
  lastPlay: LastPlay | null
  passesSinceLastPlay: number
  phase: Phase
  finishedCount: number
}

export function createInitialState(playerIds: string[], rng: () => number): GameState {
  const { hands, kitty } = deal(shuffle(makeFullDeck(), rng), playerIds.length, 16)
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

- [ ] **Step 4: 运行确认通过**

Run: `cd server && npx vitest run src/engine/paodekuai/state.test.ts`
Expected: PASS（3 用例）。

- [ ] **Step 5: Commit**

```bash
git add server/src/engine/paodekuai/state.ts server/src/engine/paodekuai/state.test.ts
git commit -m "feat(engine): game state types and initialization"
```

---

## Task 7: 规则——出牌与过牌（rules.ts）

**Files:**
- Create: `server/src/engine/paodekuai/rules.ts`
- Test: `server/src/engine/paodekuai/rules.test.ts`

定义跑得快自己的动作 / 事件类型，以及无状态纯函数 `applyAction`。`engine.ts`（Task 8）把它包成契约实现。

- [ ] **Step 1: 写失败测试**

```typescript
import { describe, it, expect } from 'vitest'
import { applyAction, type PdkAction } from './rules'
import type { GameState, PlayerState } from './state'
import type { Card } from './card'

const card = (rank: Card['rank'], suit: Card['suit'] = 'C'): Card => ({ rank, suit })

function fixedState(): GameState {
  const players: PlayerState[] = [
    { id: 'p1', hand: [card('5'),card('6'),card('7')], finishedRank: null },
    { id: 'p2', hand: [card('8'),card('9'),card('10')], finishedRank: null },
    { id: 'p3', hand: [card('J'),card('Q'),card('K')], finishedRank: null },
  ]
  return { players, kitty: [], currentPlayer: 0, lastPlay: null,
    passesSinceLastPlay: 0, phase: 'PLAYING', finishedCount: 0 }
}

describe('applyAction - PLAY', () => {
  it('valid lead removes cards and advances turn', () => {
    const { state, events } = applyAction(fixedState(), { type: 'PLAY', playerIndex: 0, cards: [card('5')] })
    expect(state.players[0]!.hand).toHaveLength(2)
    expect(state.currentPlayer).toBe(1)
    expect(state.lastPlay?.combo.type).toBe('SINGLE')
    expect(events).toContainEqual({ type: 'PLAYED', playerIndex: 0, comboType: 'SINGLE' })
  })
  it('rejects out of turn', () => {
    const { state, events } = applyAction(fixedState(), { type: 'PLAY', playerIndex: 1, cards: [card('8')] })
    expect(state.players[1]!.hand).toHaveLength(3)
    expect(events).toContainEqual({ type: 'REJECTED', reason: 'NOT_YOUR_TURN' })
  })
  it('rejects cards not in hand', () => {
    const { events } = applyAction(fixedState(), { type: 'PLAY', playerIndex: 0, cards: [card('2')] })
    expect(events).toContainEqual({ type: 'REJECTED', reason: 'NOT_IN_HAND' })
  })
  it('rejects illegal combo', () => {
    const { events } = applyAction(fixedState(), { type: 'PLAY', playerIndex: 0, cards: [card('5'),card('7')] })
    expect(events).toContainEqual({ type: 'REJECTED', reason: 'ILLEGAL_COMBO' })
  })
  it('rejects following play that cannot beat', () => {
    let st = applyAction(fixedState(), { type: 'PLAY', playerIndex: 0, cards: [card('7')] }).state
    st.players[1]!.hand = [card('4'),card('9'),card('10')]
    const r = applyAction(st, { type: 'PLAY', playerIndex: 1, cards: [card('4')] })
    expect(r.events).toContainEqual({ type: 'REJECTED', reason: 'CANNOT_BEAT' })
  })
})

describe('applyAction - PASS', () => {
  function leadState(): GameState {
    const players: PlayerState[] = [
      { id: 'p1', hand: [card('K')], finishedRank: null },
      { id: 'p2', hand: [card('4'),card('5')], finishedRank: null },
      { id: 'p3', hand: [card('6'),card('7')], finishedRank: null },
    ]
    return { players, kitty: [], currentPlayer: 1,
      lastPlay: { playerIndex: 0, combo: { type: 'SINGLE', power: 11, length: 1, cards: [card('K')] } },
      passesSinceLastPlay: 0, phase: 'PLAYING', finishedCount: 0 }
  }
  it('pass advances turn and increments count', () => {
    const { state, events } = applyAction(leadState(), { type: 'PASS', playerIndex: 1 })
    expect(state.currentPlayer).toBe(2)
    expect(state.passesSinceLastPlay).toBe(1)
    expect(events).toContainEqual({ type: 'PASSED', playerIndex: 1 })
  })
  it('cannot pass on lead', () => {
    const st = leadState(); st.lastPlay = null; st.currentPlayer = 0
    const { events } = applyAction(st, { type: 'PASS', playerIndex: 0 })
    expect(events).toContainEqual({ type: 'REJECTED', reason: 'MUST_PLAY_ON_LEAD' })
  })
  it('all others pass clears table back to last player', () => {
    let st = applyAction(leadState(), { type: 'PASS', playerIndex: 1 }).state
    const r = applyAction(st, { type: 'PASS', playerIndex: 2 })
    expect(r.state.lastPlay).toBeNull()
    expect(r.state.currentPlayer).toBe(0)
    expect(r.events).toContainEqual({ type: 'TABLE_CLEARED', leadPlayer: 0 })
  })
})

describe('applyAction - TIMEOUT', () => {
  it('TIMEOUT on lead is treated as no-op reject (paodekuai has no wait window)', () => {
    const st = fixedState()
    const { state, events } = applyAction(st, { type: 'TIMEOUT' })
    expect(state).toEqual(st)
    expect(events).toContainEqual({ type: 'REJECTED', reason: 'NO_OP' })
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd server && npx vitest run src/engine/paodekuai/rules.test.ts`
Expected: FAIL — applyAction/PdkAction 未定义。

- [ ] **Step 3: 实现 rules.ts**

```typescript
import type { Card } from './card'
import { cardId } from './card'
import { identifyCombo, canBeat, type ComboType } from './combo'
import type { GameState } from './state'

export type PdkAction =
  | { type: 'PLAY'; playerIndex: number; cards: Card[] }
  | { type: 'PASS'; playerIndex: number }
  | { type: 'TIMEOUT' } // 系统动作：房间层计时器触发。跑得快无等待窗口，视为 no-op。

export type RejectReason =
  | 'NOT_YOUR_TURN' | 'NOT_IN_HAND' | 'ILLEGAL_COMBO' | 'CANNOT_BEAT'
  | 'GAME_FINISHED' | 'MUST_PLAY_ON_LEAD' | 'NO_OP'

export type PdkEvent =
  | { type: 'PLAYED'; playerIndex: number; comboType: ComboType }
  | { type: 'PASSED'; playerIndex: number }
  | { type: 'REJECTED'; reason: RejectReason }
  | { type: 'TABLE_CLEARED'; leadPlayer: number }
  | { type: 'PLAYER_FINISHED'; playerIndex: number; rank: number }
  | { type: 'GAME_OVER' }

export interface ApplyResult { state: GameState; events: PdkEvent[] }

function reject(state: GameState, reason: RejectReason): ApplyResult {
  return { state, events: [{ type: 'REJECTED', reason }] }
}

function handHasAll(hand: Card[], cards: Card[]): boolean {
  const pool = new Map<string, number>()
  for (const c of hand) pool.set(cardId(c), (pool.get(cardId(c)) ?? 0) + 1)
  for (const c of cards) {
    const k = cardId(c); const n = pool.get(k) ?? 0
    if (n <= 0) return false
    pool.set(k, n - 1)
  }
  return true
}

function removeCards(hand: Card[], cards: Card[]): Card[] {
  const toRemove = new Map<string, number>()
  for (const c of cards) toRemove.set(cardId(c), (toRemove.get(cardId(c)) ?? 0) + 1)
  const out: Card[] = []
  for (const c of hand) {
    const k = cardId(c); const n = toRemove.get(k) ?? 0
    if (n > 0) { toRemove.set(k, n - 1); continue }
    out.push(c)
  }
  return out
}

function nextPlayer(state: GameState, from: number): number {
  return (from + 1) % state.players.length
}

export function applyAction(state: GameState, action: PdkAction): ApplyResult {
  if (state.phase === 'FINISHED') return reject(state, 'GAME_FINISHED')
  if (action.type === 'TIMEOUT') return reject(state, 'NO_OP')
  if (action.playerIndex !== state.currentPlayer) return reject(state, 'NOT_YOUR_TURN')

  if (action.type === 'PLAY') {
    const player = state.players[action.playerIndex]!
    if (!handHasAll(player.hand, action.cards)) return reject(state, 'NOT_IN_HAND')
    const combo = identifyCombo(action.cards)
    if (!combo) return reject(state, 'ILLEGAL_COMBO')
    if (state.lastPlay && !canBeat(combo, state.lastPlay.combo)) return reject(state, 'CANNOT_BEAT')

    const newHand = removeCards(player.hand, action.cards)
    const players = state.players.map((p, i) => i === action.playerIndex ? { ...p, hand: newHand } : p)
    const events: PdkEvent[] = [{ type: 'PLAYED', playerIndex: action.playerIndex, comboType: combo.type }]

    let finishedCount = state.finishedCount
    if (newHand.length === 0) {
      finishedCount += 1
      players[action.playerIndex] = { ...players[action.playerIndex]!, finishedRank: finishedCount }
      events.push({ type: 'PLAYER_FINISHED', playerIndex: action.playerIndex, rank: finishedCount })
    }

    if (finishedCount >= 1) {
      return {
        state: { ...state, players, finishedCount, phase: 'FINISHED',
          lastPlay: { playerIndex: action.playerIndex, combo } },
        events: [...events, { type: 'GAME_OVER' }],
      }
    }

    return {
      state: { ...state, players,
        lastPlay: { playerIndex: action.playerIndex, combo },
        passesSinceLastPlay: 0,
        currentPlayer: nextPlayer(state, action.playerIndex),
        finishedCount },
      events,
    }
  }

  // PASS
  if (!state.lastPlay) return reject(state, 'MUST_PLAY_ON_LEAD')
  const passes = state.passesSinceLastPlay + 1
  const events: PdkEvent[] = [{ type: 'PASSED', playerIndex: action.playerIndex }]
  if (passes >= state.players.length - 1) {
    return {
      state: { ...state, lastPlay: null, passesSinceLastPlay: 0, currentPlayer: state.lastPlay.playerIndex },
      events: [...events, { type: 'TABLE_CLEARED', leadPlayer: state.lastPlay.playerIndex }],
    }
  }
  return {
    state: { ...state, passesSinceLastPlay: passes, currentPlayer: nextPlayer(state, action.playerIndex) },
    events,
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd server && npx vitest run src/engine/paodekuai/rules.test.ts`
Expected: PASS（9 用例）。

- [ ] **Step 5: Commit**

```bash
git add server/src/engine/paodekuai/rules.ts server/src/engine/paodekuai/rules.test.ts
git commit -m "feat(engine): paodekuai play/pass/timeout rules"
```

---

## Task 8: 契约实现 PaodekuaiEngine（engine.ts）+ 可替换性测试

**Files:**
- Create: `server/src/engine/paodekuai/engine.ts`
- Test: `server/src/engine/contract.test.ts`

- [ ] **Step 1: 写失败测试（关键：用 GameEngine 接口类型持有实现，验证可替换）**

```typescript
// contract.test.ts
import { describe, it, expect } from 'vitest'
import type { GameEngine } from './contract'
import { PaodekuaiEngine } from './paodekuai/engine'
import type { GameState } from './paodekuai/state'
import type { PdkAction, PdkEvent } from './paodekuai/rules'

function seededRandom(seed: number): () => number {
  let s = seed >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0xffffffff }
}

describe('PaodekuaiEngine satisfies GameEngine contract', () => {
  // 只用接口类型持有，房间层将来就是这样用——编译通过即证明可替换
  const engine: GameEngine<GameState, PdkAction, PdkEvent> = new PaodekuaiEngine()

  it('kind is paodekuai', () => {
    expect(engine.kind).toBe('paodekuai')
  })

  it('createInitialState + step + isFinished + ranking work through the interface', () => {
    let st = engine.createInitialState(['p1','p2','p3'], seededRandom(123))
    expect(engine.isFinished(st)).toBe(false)

    let over = false, guard = 0
    while (!over && guard < 2000) {
      guard++
      const cur = st.currentPlayer
      const hand = st.players[cur]!.hand
      // 贪心：能出最小单张就出，否则 pass
      const sorted = [...hand].sort((a, b) =>
        a.rank.localeCompare(b.rank)) // 仅需稳定顺序，合法性由引擎判
      let acted = false
      for (const c of sorted) {
        const r = engine.step(st, { type: 'PLAY', playerIndex: cur, cards: [c] })
        if (r.events.some((e) => e.type === 'REJECTED')) continue
        st = r.state
        if (r.events.some((e) => e.type === 'GAME_OVER')) over = true
        acted = true
        break
      }
      if (!acted) st = engine.step(st, { type: 'PASS', playerIndex: cur }).state
    }

    expect(over).toBe(true)
    expect(engine.isFinished(st)).toBe(true)

    const ranking = engine.ranking(st)
    expect(ranking).toHaveLength(3)
    expect(ranking[0]!.rank).toBe(1)
    // 每条都有 playerId 和 score
    for (const r of ranking) {
      expect(typeof r.playerId).toBe('string')
      expect(typeof r.score).toBe('number')
    }
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd server && npx vitest run src/engine/contract.test.ts`
Expected: FAIL — PaodekuaiEngine 未定义。

- [ ] **Step 3: 实现 engine.ts**

```typescript
import type { GameEngine, RankEntry } from '../contract'
import type { GameState } from './state'
import { createInitialState } from './state'
import { applyAction, type PdkAction, type PdkEvent } from './rules'

export class PaodekuaiEngine implements GameEngine<GameState, PdkAction, PdkEvent> {
  readonly kind = 'paodekuai'

  createInitialState(playerIds: string[], rng: () => number): GameState {
    return createInitialState(playerIds, rng)
  }

  step(state: GameState, action: PdkAction) {
    return applyAction(state, action)
  }

  isFinished(state: GameState): boolean {
    return state.phase === 'FINISHED'
  }

  ranking(state: GameState): RankEntry[] {
    // 已出完者按 finishedRank；其余按手牌数升序补名次。
    // score：跑得快用负的剩牌数（手牌越少分越高，冠军为 0）。
    const ordered = state.players
      .map((p, i) => ({ p, i }))
      .sort((a, b) => {
        const ra = a.p.finishedRank, rb = b.p.finishedRank
        if (ra && rb) return ra - rb
        if (ra) return -1
        if (rb) return 1
        return a.p.hand.length - b.p.hand.length
      })
    return ordered.map(({ p }, idx) => ({
      playerId: p.id,
      rank: idx + 1,
      score: -p.hand.length,
    }))
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd server && npx vitest run src/engine/contract.test.ts`
Expected: PASS（2 用例，且不触 guard 上限）。

- [ ] **Step 5: Commit**

```bash
git add server/src/engine/paodekuai/engine.ts server/src/engine/contract.test.ts
git commit -m "feat(engine): PaodekuaiEngine implements GameEngine contract"
```

---

## Task 9: 导出聚合（index.ts）+ 全量验证

**Files:**
- Create: `server/src/engine/paodekuai/index.ts`

- [ ] **Step 1: 实现 index.ts**

```typescript
export { PaodekuaiEngine } from './engine'
export { createInitialState } from './state'
export type { GameState, PlayerState, Phase, LastPlay } from './state'
export { applyAction } from './rules'
export type { PdkAction, PdkEvent, RejectReason } from './rules'
export { identifyCombo, canBeat } from './combo'
export type { Combo, ComboType } from './combo'
export { makeFullDeck, rankValue, cardId } from './card'
export type { Card, Rank, Suit } from './card'
```

- [ ] **Step 2: 全量测试 + 类型检查**

Run: `cd server && npx vitest run && npm run typecheck`
Expected: 全部 PASS；typecheck 无错误。

- [ ] **Step 3: Commit**

```bash
git add server/src/engine/paodekuai/index.ts
git commit -m "feat(engine): public exports for paodekuai module"
```

---

## 完成标准

- `cd server && npm test` 全绿，`npm run typecheck` 无错误。
- 引擎不引用任何网络/存储/时间 API。
- `PaodekuaiEngine` 经 `GameEngine<S,A,E>` 接口类型持有可正常工作（可替换性证明）。
- 一局跑得快可从发牌跑到 `GAME_OVER`，`ranking()` 返回带 playerId+rank+score 的结果。

## 后续计划（各自独立成文，不在本计划内）

- 房间服务 room：单房间串行、持有 `GameEngine` 接口、广播事件、计时器触发 TIMEOUT。
- 网络层 gateway：WebSocket 连接管理、心跳、断线检测。
- 状态存储 + 断线重连：内存 + Redis 快照。
- 持久层：PostgreSQL，消费 `ranking()` 的 score 落库积分。
- 第二个玩法接入时：用跑得快 + 新玩法两个样本提炼公共抽象（牌型/规则集）。
