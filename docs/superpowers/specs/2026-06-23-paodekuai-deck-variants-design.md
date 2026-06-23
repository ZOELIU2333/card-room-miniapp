# 跑得快 15/16 张双玩法 设计

**Goal:** 让跑得快引擎支持 15 张和 16 张两种发牌玩法，建房时由创建者选定，每房独立。

**Architecture:** 玩法作为引擎的初始化选项（`DeckVariant`），顺着既有初始化链路 `CREATE 消息 → RoomManager.createRoom → Room → engine.createInitialState` 透传。牌堆裁剪与发牌张数全部收敛在引擎层，`combo`/`rules` 不变。

**Tech Stack:** TypeScript ESM、Vitest、ws。沿用现有 engine/room/gateway 三层接口解耦。

---

## 决策来源

2026/06/23 与用户 brainstorming 逐项确认：

- 16 张玩法 = 整副 52 张、3 人各 16、剩 4 张 kitty、持方块3 者首出（现状不变）。
- 15 张玩法牌堆 = 52 张去掉 **3 个 2（留黑桃2）、3 个 A（留黑桃A）、1 个 K（去方块K，花色无所谓）= 45 张**，3 人各 15，kitty 0 张，持方块3 者首出。
- 除发牌张数/牌堆外，**两种玩法牌型、比较、炸弹、结算完全相同**。
- 玩法在**建房时选**，每房独立。
- 玩法参数走**方案 A**：引擎初始化选项 + CREATE 消息携带。
- **JOIN 一个不存在的房间 → 直接拒（REJECTED: ROOM_NOT_FOUND）**，不再兜底建房。

## 第 1 节：牌堆与玩法表示

- 新增 `DeckVariant = 'classic16' | 'classic15'`。
- 新增 `makeDeck(variant)`：
  - `classic16` → 现有 `makeFullDeck()`（52 张）。
  - `classic15` → 在 `makeFullDeck()` 基础上滤掉：`rank==='2' && suit!=='S'`（去 3 张，留黑桃2）、`rank==='A' && suit!=='S'`（去 3 张，留黑桃A）、`rank==='K' && suit==='D'`（去 1 张方块K）。结果 45 张。
- 15 张玩法里 2/A 各剩 1 张、K 剩 3 张，玩家天然凑不齐 4 张同点，炸弹（4 张同点）自然炸不起来——无需在 `combo`/`rules` 做任何特殊处理。
- 首出判定（持方块3 者）两种玩法都成立：方块3 始终在牌堆里、各发完后必在某玩家手上。

## 第 2 节：引擎契约与发牌链路

- `GameEngine.createInitialState` 签名加第三参：`createInitialState(playerIds, rng, variant)`（改 `contract.ts`、`engine.ts`、`state.ts`）。
- `state.ts` 的 `createInitialState`：
  - `const perPlayer = variant === 'classic15' ? 15 : 16`
  - `deal(shuffle(makeDeck(variant), rng), playerIds.length, perPlayer)`
  - 首出逻辑不变。
- `RoomDeps` 加 `variant: DeckVariant` 字段；`Room.start()` 调 `engine.createInitialState(this.seatOrder, this.deps.rng, this.deps.variant)`。
- `RoomManager.createRoom(roomId, variant?: DeckVariant)` 加可选参，默认 `'classic16'`，建 `Room` 时透传到 `RoomDeps.variant`。默认值保证现有调用（composition.ts、测试）零改动。

## 第 3 节：建房协议与装配

- 协议 `ClientMessage` 的 `CREATE` 分支加 `variant: DeckVariant` 字段。
- `parseClientMessage`：`CREATE` 读 `payload.variant`；值为 `'classic15'` 或 `'classic16'` 时透传，缺省或非法值一律落 `'classic16'`（体验版宽松，不报错）。`JOIN` 不解析 variant（房间玩法创建时已定）。
- gateway 路由调整：
  - `CREATE` → `this.manager.getRoom(msg.roomId) ?? this.manager.createRoom(msg.roomId, msg.variant)`。
  - `JOIN` → `this.manager.getRoom(msg.roomId)`，不存在则 `sendTo(socket, reject('ROOM_NOT_FOUND'))` 并 return；存在则照常 `canJoin` → 入座。
  - `CREATE`/`JOIN` 拆成两条路径处理（现在是合并的 `case 'CREATE': case 'JOIN':`）。
- composition.ts、main.ts 无需改动（createServer 不感知玩法，玩法只在运行期由 CREATE 消息驱动）。

## 第 4 节：测试策略

- **deck/card 层**：`makeDeck('classic15')` 返回 45 张、含黑桃2 与黑桃A、不含方块K、其余每点数 4 张；`makeDeck('classic16')` 仍 52 张。
- **state 层**：`createInitialState(3人, rng, 'classic15')` → 各 15 张、kitty 长度 0、首出指向方块3 持有者；`'classic16'` → 各 16、kitty 4、首出正确。
- **rules/combo 层**：不新增（规则未变），跑现有测试确保零回归。
- **协议层**：`parseClientMessage` CREATE 带 `variant:'classic15'` → 透传；缺省 → `'classic16'`；非法值 → `'classic16'`。
- **gateway 层**：CREATE 带 `variant:'classic15'` → 房间按 15 张开局（断言某玩家手牌 15 张）；JOIN 不存在房间 → `REJECTED ROOM_NOT_FOUND`。
- **端到端**：`e2e-smoke.mjs` 增一轮 `classic15`（CREATE 带 variant），验证各 15 张、走完一局到 GAME_OVER。

## 文件改动清单

- 改 `src/engine/paodekuai/card.ts`（或新建 `deck.ts` 旁的 variant 定义）：`DeckVariant`、`makeDeck`。
- 改 `src/engine/contract.ts`：`createInitialState` 签名加 variant。
- 改 `src/engine/paodekuai/engine.ts`：透传 variant。
- 改 `src/engine/paodekuai/state.ts`：按 variant 选牌堆与 perPlayer。
- 改 `src/room/room.ts`：`RoomDeps.variant`、`start()` 透传。
- 改 `src/room/manager.ts`：`createRoom(roomId, variant?)`。
- 改 `src/gateway/protocol.ts`：CREATE 带 variant、宽松校验。
- 改 `src/gateway/gateway.ts`：CREATE/JOIN 路由拆分、JOIN 空房拒。
- 改 `scripts/e2e-smoke.mjs`：加 classic15 轮次。
- 各层对应 `*.test.ts` 新增用例。
