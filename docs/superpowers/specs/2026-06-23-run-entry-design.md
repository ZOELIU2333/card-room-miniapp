# Run-Entry 设计：把三层零件装配成可运行进程

日期：2026-06-23
状态：待实现
前置：engine / room / gateway 三层已完成，104 测试绿，typecheck 干净。

## 背景与目标

engine、room、gateway 三个模块都已是绿测的库，但**没有任何一个能真正跑起来的进程**。具体缺口：

- 没有 `start` script，没有入口文件。
- `gateway/index.ts` 的 `createGateway` 只构造 `WsGateway` 并起 wss，**没有 attach RoomManager**。而 `WsGateway.route()` 大量使用 `this.manager!`——一收到 CREATE/JOIN 就会崩。
- RoomManager 与 gateway 互为依赖：RoomManager 需要 `transport`（就是 gateway），gateway 需要 `manager`。这个循环依赖必须在装配时按序解开。

本期目标：用最轻量、可单测的方式把零件串成一个 `npm start` 能真跑、可用 wscat 端到端联调的进程。不引入 Redis/Postgres/微信密钥依赖——StubAuth + 内存 store 即可独立验证。

## 架构红线遵循

- **三层解耦**：run-entry 是装配层，依赖各模块已导出的接口与实现。**唯一会改动 gateway 的地方是补一个 `stopHeartbeat()` 方法**（服务于优雅关闭），不触碰 gateway 的网络职责，不改其路由/状态机。
- **gateway 仍是唯一碰 ws 的层**：run-entry 通过 `createGateway`（已有的真 ws adapter）起 wss，不直接 import 'ws'。`grep -rln "from 'ws'" src/` 应仍只出 `gateway/index.ts`。

## 文件布局

三个新文件，全在 `server/src/`：

### `config.ts`
导出 `loadConfig(env: NodeJS.ProcessEnv): Config` —— 纯函数。
- 读取并给默认值：
  - `PORT`（默认 8080）
  - `HEARTBEAT_MS`（默认 30000）
  - `TURN_MS`（默认 30000，回合超时）
  - `ROOM_CAPACITY`（默认 3，跑得快 3 人）
  - `WX_APPID` / `WX_SECRET`（无默认；两者都有则启用微信认证）
- 数值项解析失败或 <= 0 时抛错（fail fast，不静默吞）。
- `Config` 结构：`{ port, heartbeatMs, turnMs, capacity, wx: { appid, secret } | null }`。
- 不做 `process.env` 之外的任何 IO。

### `composition.ts`
导出 `createServer(config: Config, opts?: { wssFactory?: (port: number) => WebSocketServerLike }): RunningServer` —— 纯装配，**不碰信号、不碰 `process.env`**。

`wssFactory` 默认构造真 `WebSocketServer`；测试可注入 fake，避免占端口、便于断言装配正确。

返回 `RunningServer = { gateway, manager, wss, shutdown: () => Promise<void> }`。

### `main.ts`
极薄入口：
1. `const config = loadConfig(process.env)`
2. `const server = createServer(config)`
3. 打启动日志：监听端口 + 认证模式（stub / wechat）。
4. 注册 `SIGINT` / `SIGTERM` 处理器：触发时 `await server.shutdown()` → 打 "shutdown complete" → `process.exit(0)`。

`package.json` 新增：
- devDependency：`tsx`
- script：`"start": "tsx src/main.ts"`

## 装配顺序（解循环依赖）

`createServer` 内部严格按序，这是本设计的核心：

1. **选 authenticator**：`config.wx` 非 null → `new WechatAuthenticator(config.wx, globalThis.fetch)`；否则 `new StubAuthenticator()`。
2. **建 gateway**：`const gateway = new WsGateway({ authenticator })`。
3. **以 gateway 当 transport 建 manager**：
   ```
   new RoomManager({
     engine: new PaodekuaiEngine(),
     transport: gateway,
     store: new InMemorySnapshotStore(),
     scheduler: realScheduler,
     capacity: config.capacity,
     turnMs: config.turnMs,
     rngFor: () => Math.random,   // 每房间一个 rng，生产用 Math.random
   })
   ```
4. **回填**：`gateway.attachRoomManager(manager)` ← 这一步现在 `createGateway` 没做，是 bug 高发点，必须显式执行并被测试覆盖。
5. **起 wss + 心跳**：用 `wssFactory(config.port)` 起 server，`connection` 事件交给 `gateway.handleConnection(wrap(ws))`；用 `gateway.startHeartbeat(intervalScheduler, config.heartbeatMs)` 启心跳。
   - 真 ws adapter 的 `wrap` 与 intervalScheduler 逻辑已存在于 `gateway/index.ts`；composition 复用，不重写。视实现便利，可让 `createServer` 内联这套装配，或扩展 `createGateway` 接受已建好的 gateway——实现期定，不改 gateway 路由职责即可。

## 数据流（运行时）

run-entry 的职责到"接通管道"为止，运行期不持有每请求状态：

- 连接进来 → wss `connection` 事件 → `gateway.handleConnection(wrap(ws))`。run-entry 不插手。
- 之后 AUTH / CREATE / JOIN / PLAY / PASS / RESUME 全走 gateway 已有路由 → RoomManager / Room → 引擎。此刻 run-entry 代码已不在调用栈。
- 唯一由 run-entry 注入的"活"依赖：`rngFor: () => Math.random`（生产随机）与 `globalThis.fetch`（给 WechatAuthenticator）。其余全是已测零件。

## 关闭语义

`shutdown()` 闭包按序执行，**幂等**（第二次起空操作）：
1. 停心跳：调 `gateway.stopHeartbeat()`（本期给 gateway 新增的方法，clear 掉 `startHeartbeat` 起的 interval）。
2. `wss.close()`：停止接受新连接。
3. 关闭现存活连接（遍历 `wss.clients` 或经 registry 全部 close）。
4. resolve。

内存 store 重启即丢，**不做关闭前强制快照**（已拍板；留到 Redis 适配后才有价值）。

`main.ts` 在 SIGINT/SIGTERM 时 `await shutdown()` 后 `process.exit(0)`。

## gateway 的本期改动

新增 `WsGateway.stopHeartbeat(): void`：
- 若持有 Heartbeat，调其停止方法（clear interval）并置空引用。
- 无心跳时空操作。
- 该方法仅服务进程关闭，不影响路由/状态机。需补对应单测（起心跳后 stop，断言 interval 被 clear）。

## 日志

仅在进程生命周期关键点用 `console.log`：
- 启动：监听端口 + 认证模式。
- 收到关闭信号。
- 关闭完成。

不给每条 ws 消息打日志（那是 gateway 内部的事，且会刷屏）。零日志库依赖。

## 测试策略

- **`config.test.ts`**：默认值；env 覆盖每一项；非法/负数值抛错；有 WX_APPID+WX_SECRET → wx 非 null，缺其一 → wx 为 null。纯函数，好测。
- **`composition.test.ts`**（核心）：注入 fake `wssFactory`，断言——
  - manager 已 attach 到 gateway（覆盖那个易错的循环依赖顺序）：可通过 createServer 后驱动一条 JOIN 流程不抛 `this.manager!` 错误来验证，或暴露最小可观察点。
  - authenticator 按 config 选对类型（有 wx → Wechat，无 → Stub）。
  - `shutdown()` 可调、幂等（连调两次第二次不抛、不重复 close）。
  - `shutdown()` 调到了 `gateway.stopHeartbeat()`（fake scheduler 断言 clear 被调）。
- **`gateway/heartbeat` 或 `gateway.test.ts`**：`stopHeartbeat()` 的单测。
- **`main.ts` 不单测**：碰真 `process`/信号，沙箱也起不了长驻进程。端到端 wscat 由用户在本机验证。

## 验收

- `npm start` 在本机能起进程、打印监听端口与认证模式（stub）。
- wscat 连上后走 AUTH → CREATE → 3 个连接 JOIN → 自动开局发牌 → PLAY/PASS 推进 → 结算，端到端通（用户本机验证）。
- Ctrl-C 触发优雅关闭，打印 "shutdown complete" 后退出，端口释放（重跑不撞 EADDRINUSE）。
- 全部单测绿，typecheck 干净。`grep -rln "from 'ws'" src/` 仍只出 `gateway/index.ts`。

## 不在本期范围

- Redis SnapshotStore 适配（独立成块）。
- Postgres 积分持久层（独立成块）。
- 真微信认证的密钥环境验证（WechatAuthenticator 已就绪，留待有密钥时验）。
- 关闭前强制快照、连接限流、多进程/集群。
