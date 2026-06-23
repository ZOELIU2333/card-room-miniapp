# WebSocket 网络层（gateway）设计

> 第一版后端对局链路的第三块：最外层网络层。room 层设计见 [room 设计 spec](2026-06-23-room-service-design.md)，整体技术选型与红线见 [TECH_DESIGN](../../TECH_DESIGN.md)。

## 目标

实现一个 WebSocket 网络层：管理 ws 连接、认证玩家身份、把入站 JSON 消息翻译成 room 的 `Command` 投给对应 Room、维护连接↔玩家↔房间映射以支撑广播与断线重连、用协议级 ping/pong 检测断线。gateway 实现 room 已定义的 `Transport` 接口，是整个系统中唯一认识 `ws` 库的层；room 与 engine 不变、仍不认识网络。

## 范围

**本轮做**：实现 `Transport` 的 ws gateway + 认证（`Authenticator` 接口 + 微信真 code2session 实现 + stub）+ 连接/房间映射 + 心跳 + 断线重连接回。

**本轮不做**（各自独立成文）：Redis 快照适配层、Postgres 持久层、真微信 API 联调验证（需开发资质+密钥，沙箱连不上）、前端小程序侧。

## 架构

gateway 是最外层，持有 `RoomManager`，通过两个接口解耦：

- **实现** room 的 `Transport`（`send`/`broadcast`/`kick`）：把消息落到具体的 ws 连接上。
- **依赖**新增的 `Authenticator` 接口：`authenticate(code) => Promise<string>`（返回 playerId）。本轮提供两个实现：
  - `WechatAuthenticator`：真 code2session，`code → https://api.weixin.qq.com/sns/jscode2session → openid`，appid/secret 注入，HTTP 经注入的 fetch 以便 mock 测试。
  - `StubAuthenticator`：`code` 直接当 playerId，供本地联调 / 无密钥环境。

引入新依赖：`ws` + `@types/ws`。

红线对齐：gateway 是唯一碰 ws 的层；认证经接口可换；room/engine 零改动。

## 线路协议

JSON 文本帧，入站与出站对称：

- **入站 `ClientMessage { type, payload }`**：`AUTH{code}`、`CREATE{roomId}`、`JOIN{roomId}`、`PLAY{cards}`、`PASS`、`RESUME`。
- **出站**：复用 room 的 `ServerMessage { type, payload }`（room 已产出 STATE / GAME_OVER / REJECTED），gateway 另发认证/协议层的 REJECTED。

棋牌消息量小，JSON 可读、好调试（wscat 可直接打字），不在乎带宽。

## 组件分解

```
server/src/gateway/
  protocol.ts          # ClientMessage 类型(入站) + 解析/校验;出站复用 room 的 ServerMessage
  auth.ts              # Authenticator 接口 + StubAuthenticator + WechatAuthenticator
  registry.ts          # ConnectionRegistry:connId↔socket、playerId↔connId、playerId↔roomId 三组映射
  connection.ts        # Connection:单连接状态机(CONNECTED→AUTHED→IN_ROOM) + 心跳存活标记
  heartbeat.ts         # Heartbeat:定期 ping、判死、清理(注入 scheduler,可单测)
  gateway.ts           # WsGateway:实现 Transport,接 ws server,路由消息,驱动心跳
  index.ts             # 对外导出 + createGateway 装配入口
```

`gateway.ts` 是装配层；其余是它依赖的、可独立测试的零件。心跳与注册表抽出，让 gateway 路由测试不必纠缠这些细节。

## 连接生命周期

两阶段，状态机 `CONNECTED → AUTHED → IN_ROOM`：

1. ws 连上 → 状态 CONNECTED。此时只接受 `AUTH`；其他消息回 `REJECTED{reason:'NOT_AUTHED'}`。
2. `AUTH{code}` → `authenticator.authenticate(code)` 拿 playerId → 状态 AUTHED，registry 记 playerId↔connId（若同 playerId 已有旧连接，先顶掉旧的——单玩家单连接）。
3. `CREATE{roomId}` / `JOIN{roomId}` → 经 RoomManager 拿/建 Room → registry 记 playerId↔roomId → `room.enqueue({type:'JOIN', playerId})` → 状态 IN_ROOM。一个连接同时只在一个房间。
4. `PLAY{cards}` / `PASS` → `room.enqueue` 对应 Command（仅 IN_ROOM 状态接受）。
5. `RESUME` → 查 playerId→roomId 找回 Room，绑回新 socket，从 Room 当前状态推一份脱敏快照。

## 连接 / 玩家 / 房间映射

room 的 `Transport.broadcast(roomId, msg)` 要求 gateway 知道哪些连接属于该房间——room 从不告诉 gateway 谁在哪个房。gateway 作为 Transport 实现自己维护三组映射（`ConnectionRegistry`）：

- `connId → socket`：物理连接。
- `playerId → connId`：当前活跃连接（重连时顶号）。
- `playerId → roomId`：玩家所在房间（JOIN 时记，断线**保留**以便重连接回）。

广播：`broadcast(roomId, msg)` 找出该房所有成员 playerId → connId → socket 逐个发；`send(playerId, msg)` 单点；`kick(playerId)` 关其连接。发给已断玩家时查不到活 socket 即静默跳过。

## 心跳与断线检测

协议级 ws ping/pong：

- `Heartbeat` 定期（如 30s）对每个连接发 ws ping，并标记“本轮待确认”。
- 收到 pong 清除标记。下一轮开始时仍未确认的连接判死 → `terminate()` → 触发 close。
- 计时用注入的 scheduler（复用 room 的 `TimerScheduler` 模式），测试用假时钟，不依赖真实时间。
- 客户端无需写代码（ws 协议层自动回 pong）。

## 错误处理与边界

- **认证失败**：`authenticate` 抛错/返回空 → `REJECTED{reason:'AUTH_FAILED'}`，连接停在 CONNECTED。
- **协议错误**：非法 JSON / 缺 type / 未知 type → `REJECTED{reason:'BAD_MESSAGE'}`，不崩连接。
- **越界消息**：未认证发 JOIN/PLAY → `NOT_AUTHED`；未进房发 PLAY/PASS → `NOT_IN_ROOM`。
- **断线**：ws close/error 或心跳判死 → 清 `connId↔socket`、`playerId↔connId`；**保留 `playerId→roomId`** 供重连；**不**调 room 退出（room 超时代打兜底）。
- **重连**：同 playerId 重新 AUTH 时顶掉旧 connId；`RESUME` 绑回 Room 并推当前脱敏状态。
- **微信 code2session 失败**（errcode 非 0 / 网络错）：`WechatAuthenticator` 抛带 errcode 的错，gateway 转 AUTH_FAILED。

## 测试策略

ws 层用一个**假 socket**（实现最小 `send`/`close`/`ping`/`terminate`/`on` 接口），零真实网络：

- **protocol**：合法 / 非法 JSON / 缺 type / 未知 type 的解析与校验。
- **auth**：`StubAuthenticator` 直通；`WechatAuthenticator` 用注入的 mock fetch 测三路——成功（返 openid）、errcode 失败、网络错。
- **registry**：三组映射增删查、重连顶号、断线清理（保留 playerId→roomId）。
- **heartbeat**：假时钟驱动，没 pong 的连接被判死清理、有 pong 的存活。
- **gateway 集成（最关键）**：假 socket 驱动一条连接走 AUTH→CREATE→对局消息，断言路由正确、越界被拒、广播只到该房成员、断线后同 playerId RESUME 接回并收到当前状态。引擎/房间用真实现，仅 ws 与微信 HTTP 是假的。

## 完成标准

- gateway `npm test` 全绿，`npm run typecheck` 无错误。
- 一条假 socket 连接可走完 AUTH → CREATE/JOIN → 出牌 → 收广播 的完整链路。
- 三类越界（未认证、未进房、协议错）各回对应 REJECTED，连接不崩。
- 断线（心跳判死或 close）清理连接映射、保留房间映射；同 playerId RESUME 能接回并收到当前脱敏状态。
- `WechatAuthenticator` 真 code2session 逻辑用 mock fetch 验证成功/失败/网络错三路。
- gateway 是唯一 import `ws` 的模块；room/engine 未改动。

## 后续计划（各自独立成文，不在本计划内）

- Redis 适配层：实现 room 的 `SnapshotStore`，对接真 Redis，跑接口契约测试。
- 持久层：PostgreSQL，消费 `ranking()` 的 score 落库积分与战绩。
- 真微信联调：拿到 appid/secret 后用 `WechatAuthenticator` 接真 jscode2session 验证。
- 前端小程序：原生微信小程序侧的 ws 客户端、建房分享、牌桌 UI。
