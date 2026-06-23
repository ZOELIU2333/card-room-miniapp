# 房间服务（room）设计

> 第一版后端对局链路的第二块：engine 之上、网络之下的房间层。引擎设计见 [跑得快引擎计划](../plans/2026-06-23-paodekuai-engine.md)，整体技术选型与红线见 [TECH_DESIGN](../../TECH_DESIGN.md)。

## 目标

实现一个纯内存、可单测的房间服务：管理房间生命周期与成员、把玩家意图串行投递给 `GameEngine` 引擎、经抽象接口广播状态、用计时器驱动超时代打，并通过整房间快照支撑断线重连。room 只依赖与玩法无关的 `GameEngine<S,A,E>` 契约，永不认识具体玩法。

## 范围

**本轮做**：纯内存可测的 room 核心 + 快照接口（含内存实现 + Redis 薄适配层）。

**本轮不做**（各自独立成文）：真 WebSocket gateway、Redis 实例联调验证（沙箱连不上）、Postgres 持久层、第二个玩法。

## 架构

room 通过两个接口与外界解耦，本身零外部依赖：

- **`Transport`**（向下游网络）：`send(playerId, msg)` / `broadcast(roomId, msg)` / `kick(playerId)`。gateway 实现真 ws 版，测试用假 transport。room 不认识 WebSocket。
- **`SnapshotStore`**（状态持久）：`save(roomId, snapshot)` / `load(roomId)`。内存实现用于测试；Redis 实现是薄适配层。
- **`GameEngine<S,A,E>`**（向上游引擎）：room 只依赖此契约，不认识跑得快。

三条红线对齐：服务端权威（合法性全由 `engine.step` 判定）、单房间串行（命令队列）、引擎/网络解耦（两个接口）。

## 组件分解

```
server/src/room/
  transport.ts        # Transport 接口
  snapshot.ts         # SnapshotStore 接口 + InMemorySnapshotStore + RoomSnapshot 类型
  command.ts          # Command 类型 + 串行队列 CommandQueue
  room.ts             # Room 类:生命周期/成员/串行处理/调引擎/写快照/广播
  timer.ts            # TurnTimer:起/清计时器,到期入队 TIMEOUT command,带 turn 版本号
  autoplay.ts         # 代打选牌:贪心试牌
  manager.ts          # RoomManager:按 roomId 建/找/销毁 Room,从快照重建
```

每个文件单一职责，可独立理解与测试。

## 数据流（一手出牌）

1. gateway 收到玩家消息 → 调 `room.enqueue({type:'PLAY', playerId, cards})`。
2. `CommandQueue` 串行取出 → Room 校验是否该玩家回合 → 调 `engine.step(state, action)`。
3. 拿到 `{state, events}` → **同步快路径**：经 `Transport.broadcast` 把脱敏状态（每人只看到自己手牌）+ events 发给成员；**异步慢路径**：整块写 `SnapshotStore`。
4. 若 `!isFinished` → `TurnTimer` 给下一位起计时器（带新 turn 版本号）；若 `isFinished` → 调 `ranking()` 广播结算。

计时器到期 → 入队 `{type:'TIMEOUT', turn:N}` → Room 比对 turn 版本号仍是当前回合则代打：autoplay 选出一次 PLAY/PASS，走同一条 `step` 路径。

## 超时与代打

- 轮到某人时起计时器（如 30s）。超时则 room 自动代打：**首家出最小合法单张，非首家逐张试 PLAY，都被引擎拒则 PASS**。
- 断线走同一代打逻辑，不阻塞其他玩家。
- **选牌策略（autoplay）**：room 拿手牌按牌力升序，逐张构造 PLAY 动作交 `engine.step` 试，第一个不返回 REJECTED 的即采用；全被拒则 PASS。只靠现有 `step` 接口，不扩展引擎契约。代打只求合法不求最优，逻辑在 room 内封闭。
- 不预造 `legalMoves`：等真有需要（如 AI 托管、第二个玩法）再用真实样本提炼。

## 快照与断线重连

- **整房间快照**：`RoomSnapshot` = 成员列表 + 座位 + 阶段 + 引擎 `GameState` + 当前回合号，整块 JSON 序列化。每次状态变更后整块写，恢复即整块重建。简单、原子、好测。
- **重连身份**：玩家持有建房时分配的稳定 `playerId`，重连带上；room 按 playerId 找回座位与手牌，不依赖连接对象。重连后从当前 RoomState 推一份脱敏快照给他。
- 量级：房间状态 JSON 仅几 KB，一局几百次小写入，对 Redis 无压力。

## 串行与计时器（防竞态）

- 所有进房间的操作（玩家意图、计时器到期、加入/退出）都包成 `Command` 投入串行队列，房间逐个处理。房间之间天然并行（各自一个 Room 实例），队列只在单房间内串行。
- 计时器到期不直接改状态，而是入队一个 `TIMEOUT` command。
- **turn 版本号**：每推进一回合号 +1，计时器携带起设时的回合号；处理 TIMEOUT 时比对，不匹配直接丢弃。防止"玩家刚出完、旧计时器才到期"的误触发。

## 错误处理与边界

- **广播优先、快照异步**：`step → 广播`是同步快路径（全内存，亚毫秒）；写快照是异步后台任务，失败重试。玩家手感不等 Redis。代价：断线重连的快照可能旧一两手，体验版可接受。
- **非法意图**：引擎用 `REJECTED` 事件兜底。room 把 REJECTED 只回发给那一个玩家（不广播），不改状态、不动计时器。
- **满员 / 重复加入 / 房间不存在**：RoomManager 返回明确错误，gateway 转成消息回客户端。

## 测试策略

全部用假 `Transport` + `InMemorySnapshotStore`，零外部依赖：

- **各组件单测**：CommandQueue 串行性、TurnTimer 版本号防误触、autoplay 选牌合法性、snapshot 存取与重建。
- **端到端集成测试（最关键）**：假 transport 驱动一个 Room 从建房 → 加入 3 人 → 开局 → 出牌/超时代打 → 结算，断言广播序列正确、脱敏正确（玩家看不到别人手牌）、从快照重建出的 Room 状态与原状态一致。
- **Redis 适配层**：实现 `SnapshotStore` 接口的契约测试；真 Redis 验证留到有环境时。

## 完成标准

- room 核心零外部依赖，`npm test` 全绿，`npm run typecheck` 无错误。
- 一个 Room 可用假 transport 跑完整对局到结算。
- 超时能触发合法代打；过期计时器不误触发。
- 从 `RoomSnapshot` 重建的 Room 与原状态一致（断线重连基础）。
- room 只通过 `GameEngine` / `Transport` / `SnapshotStore` 三个接口工作，不认识跑得快、不认识 WebSocket、不认识 Redis。
