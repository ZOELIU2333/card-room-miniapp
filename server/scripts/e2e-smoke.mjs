// 一次性端到端验证：起真服务（StubAuth + 内存 store），3 个真 WebSocket
// 连接走 AUTH → CREATE/JOIN → 发牌 → 自动逐张 PLAY（被拒则 PASS）直到 GAME_OVER。
// 用 tsx 跑：NODE_OPTIONS="--use-bundled-ca" ./node_modules/.bin/tsx scripts/e2e-smoke.mjs
// 跑通即退（exit 0），任何异常或超时 exit 1。

import { WebSocket } from 'ws'
import { loadConfig } from '../src/config.ts'
import { createServer } from '../src/composition.ts'

const PORT = 8123
const ROOM = 'e2e-room'
const PLAYERS = ['alice', 'bob', 'carol']
const rankValue = (r) =>
  ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'].indexOf(r)

function fail(msg) {
  console.error(`[e2e] FAIL: ${msg}`)
  process.exit(1)
}

const log = (...a) => console.log('[e2e]', ...a)

// 起真服务
const config = loadConfig({ ...process.env, PORT: String(PORT), TURN_MS: '60000' })
const server = createServer(config)
log(`server listening on :${PORT}`)

const watchdog = setTimeout(() => fail('timed out, no GAME_OVER within 30s'), 30000)

let gameOverSeen = false
const rankingByPlayer = new Map()

function makeClient(playerId) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`)
  const state = { playerId, hand: [], myTurn: false, finished: false }

  // 我的回合：从手牌里挑牌力最低的单张试 PLAY；被 REJECTED 就降级 PASS。
  // 服务端权威——非法组合由引擎拒，客户端不复刻规则。
  let triedCard = null
  function act() {
    if (!state.myTurn || state.finished) return
    if (state.hand.length === 0) return
    const sorted = [...state.hand].sort((a, b) => rankValue(a.rank) - rankValue(b.rank))
    triedCard = sorted[0]
    send({ type: 'PLAY', payload: { cards: [triedCard] } })
  }

  function send(obj) {
    ws.send(JSON.stringify(obj))
  }

  ws.on('open', () => {
    send({ type: 'AUTH', payload: { code: playerId } })
  })

  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString())
    switch (msg.type) {
      case 'AUTHED': {
        if (msg.payload.playerId !== playerId) fail(`AUTHED wrong id: ${msg.payload.playerId}`)
        // 第一个连接 CREATE，其余 JOIN（gateway 对两者一视同仁：getRoom ?? createRoom）
        const verb = playerId === PLAYERS[0] ? 'CREATE' : 'JOIN'
        send({ type: verb, payload: { roomId: ROOM } })
        return
      }
      case 'STATE': {
        // 私有视图含自己手牌（msg.payload.you.hand）；公共视图无 you 字段。
        // 私有视图无 phase 字段，但有 currentPlayer——收到私有视图即对局进行中。
        if (msg.payload.you) {
          state.hand = msg.payload.you.hand
          const seat = msg.payload.you.seat
          state.myTurn = msg.payload.currentPlayer === seat
          if (process.env.E2E_DEBUG) log(`${playerId} STATE seat=${seat} cur=${msg.payload.currentPlayer} hand=${state.hand.length} myTurn=${state.myTurn}`)
          if (state.myTurn) act()
        }
        return
      }
      case 'REJECTED': {
        if (process.env.E2E_DEBUG) log(`${playerId} REJECTED ${msg.payload.reason} (myTurn=${state.myTurn})`)
        // 试探单张被拒（不合法 / 接不上）→ 降级 PASS，推进回合
        if (state.myTurn && msg.payload.reason !== 'NOT_YOUR_TURN') {
          send({ type: 'PASS', payload: {} })
        }
        return
      }
      case 'GAME_OVER': {
        if (!gameOverSeen) {
          gameOverSeen = true
          log('GAME_OVER ranking:', JSON.stringify(msg.payload.ranking))
        }
        rankingByPlayer.set(playerId, msg.payload.ranking)
        state.finished = true
        ws.close()
        return
      }
    }
  })

  ws.on('error', (e) => fail(`ws error for ${playerId}: ${e.message}`))
  return state
}

// 顺序拉起 3 个连接（首个 CREATE 建房，后两个 JOIN，满 3 人自动开局）
PLAYERS.forEach((p, i) => setTimeout(() => makeClient(p), i * 150))

// 所有连接关闭后收尾
let closedCount = 0
const origClose = WebSocket.prototype.close
// 用轮询判断完成，避免改原型
const finishPoll = setInterval(async () => {
  if (!gameOverSeen) return
  if (rankingByPlayer.size < PLAYERS.length) return
  clearInterval(finishPoll)
  clearTimeout(watchdog)
  // 一致性校验：3 人收到的 ranking 应一致且覆盖全部玩家
  const rankings = [...rankingByPlayer.values()]
  const first = JSON.stringify(rankings[0])
  for (const r of rankings) {
    if (JSON.stringify(r) !== first) fail('rankings diverge across players')
  }
  const ranked = new Set(rankings[0].map((x) => (typeof x === 'string' ? x : x.playerId)))
  for (const p of PLAYERS) {
    if (!ranked.has(p)) fail(`player ${p} missing from final ranking`)
  }
  log(`OK: all ${PLAYERS.length} players agree on ranking, full game played end-to-end`)
  await server.shutdown()
  log('server shutdown complete')
  process.exit(0)
}, 100)
