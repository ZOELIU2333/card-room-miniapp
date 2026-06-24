// 一次性端到端验证：起真服务（StubAuth + 内存 store），每轮 3 个真 WebSocket
// 连接走 AUTH → CREATE/JOIN → 发牌 → 自动逐张 PLAY（被拒则 PASS）直到 GAME_OVER。
// 跑两轮：classic16（16 张）与 classic15（15 张），各自校验发牌张数与结算一致性。
// 用 tsx 跑：NODE_OPTIONS="--use-bundled-ca" ./node_modules/.bin/tsx scripts/e2e-smoke.mjs
// 跑通即退（exit 0），任何异常或超时 exit 1。

import { WebSocket } from 'ws'
import { loadConfig } from '../src/config.ts'
import { createServer } from '../src/composition.ts'

const PORT = 8123
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

// 两轮全程 + 收尾的总看门狗（单轮 < 15s，两轮串行 + shutdown 留足余量）
const watchdog = setTimeout(() => fail('timed out, no GAME_OVER within 60s'), 60000)

// 跑完整一局：建房（带 variant）→ 满 3 人开局 → 自动出牌至 GAME_OVER → 校验。
// 返回的 Promise 在本轮 GAME_OVER + 一致性校验通过后 resolve；任何异常走 fail() 直接 exit(1)。
function runGame({ roomId, variant, players, expectedHandSize }) {
  return new Promise((resolve) => {
    let gameOverSeen = false
    const rankingByPlayer = new Map()
    const handChecked = new Set()

    function makeClient(playerId) {
      const ws = new WebSocket(`ws://127.0.0.1:${PORT}`)
      const state = { playerId, hand: [], myTurn: false, finished: false }

      // 我的回合：从手牌里挑牌力最低的单张试 PLAY；被 REJECTED 就降级 PASS。
      // 服务端权威——非法组合由引擎拒，客户端不复刻规则。
      function act() {
        if (!state.myTurn || state.finished) return
        if (state.hand.length === 0) return
        const sorted = [...state.hand].sort((a, b) => rankValue(a.rank) - rankValue(b.rank))
        send({ type: 'PLAY', payload: { cards: [sorted[0]] } })
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
            // 首个连接 CREATE（携带 variant 建房），其余 JOIN（不带 variant，房须已存在）
            if (playerId === players[0]) {
              send({ type: 'CREATE', payload: { roomId, variant } })
            } else {
              send({ type: 'JOIN', payload: { roomId } })
            }
            return
          }
          case 'STATE': {
            // 私有视图含自己手牌（msg.payload.you.hand）；公共视图无 you 字段。
            // 私有视图无 phase 字段，但有 currentPlayer——收到私有视图即对局进行中。
            if (msg.payload.you) {
              state.hand = msg.payload.you.hand
              const seat = msg.payload.you.seat
              // 首次拿到私有视图即发牌时刻：校验本 variant 的手牌张数。
              if (!handChecked.has(playerId)) {
                handChecked.add(playerId)
                if (state.hand.length !== expectedHandSize) {
                  fail(`[${variant}] ${playerId} dealt ${state.hand.length} cards, expected ${expectedHandSize}`)
                }
                log(`[${variant}] ${playerId} dealt ${state.hand.length} cards (expected ${expectedHandSize}) OK`)
              }
              state.myTurn = msg.payload.currentPlayer === seat
              if (process.env.E2E_DEBUG) log(`[${variant}] ${playerId} STATE seat=${seat} cur=${msg.payload.currentPlayer} hand=${state.hand.length} myTurn=${state.myTurn}`)
              if (state.myTurn) act()
            }
            return
          }
          case 'REJECTED': {
            if (process.env.E2E_DEBUG) log(`[${variant}] ${playerId} REJECTED ${msg.payload.reason} (myTurn=${state.myTurn})`)
            // 试探单张被拒（不合法 / 接不上）→ 降级 PASS，推进回合
            if (state.myTurn && msg.payload.reason !== 'NOT_YOUR_TURN') {
              send({ type: 'PASS', payload: {} })
            }
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

      ws.on('error', (e) => fail(`ws error for ${playerId}: ${e.message}`))
      return state
    }

    // 顺序拉起 3 个连接（首个 CREATE 建房，后两个 JOIN，满 3 人自动开局）
    // 150ms 间隔保证 CREATE 先于 JOIN 落地（JOIN 对未知房会被 ROOM_NOT_FOUND 拒）。
    players.forEach((p, i) => setTimeout(() => makeClient(p), i * 150))

    // 轮询判断本轮完成
    const finishPoll = setInterval(() => {
      if (!gameOverSeen) return
      if (rankingByPlayer.size < players.length) return
      clearInterval(finishPoll)
      // 一致性校验：3 人收到的 ranking 应一致且覆盖全部玩家
      const rankings = [...rankingByPlayer.values()]
      const first = JSON.stringify(rankings[0])
      for (const r of rankings) {
        if (JSON.stringify(r) !== first) fail(`[${variant}] rankings diverge across players`)
      }
      const ranked = new Set(rankings[0].map((x) => (typeof x === 'string' ? x : x.playerId)))
      for (const p of players) {
        if (!ranked.has(p)) fail(`[${variant}] player ${p} missing from final ranking`)
      }
      log(`[${variant}] OK: all ${players.length} players agree on ranking, full game played end-to-end`)
      resolve()
    }, 100)
  })
}

// 两轮串行：classic16（16 张）→ classic15（15 张），各用独立房与独立玩家集。
async function main() {
  await runGame({
    roomId: 'e2e-room',
    variant: 'classic16',
    players: ['alice', 'bob', 'carol'],
    expectedHandSize: 16,
  })
  await runGame({
    roomId: 'e2e-room-15',
    variant: 'classic15',
    players: ['dave', 'erin', 'frank'],
    expectedHandSize: 15,
  })
  clearTimeout(watchdog)
  log('OK: both rounds (classic16 + classic15) verified end-to-end')
  await server.shutdown()
  log('server shutdown complete')
  process.exit(0)
}

main().catch((e) => fail(`unexpected error: ${e?.stack || e}`))
