export interface WxConfig {
  appid: string
  secret: string
}

export interface Config {
  port: number
  heartbeatMs: number
  turnMs: number
  capacity: number
  wx: WxConfig | null
}

function readPositiveInt(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key]
  if (raw === undefined || raw === '') return fallback
  const n = Number(raw)
  if (!Number.isInteger(n) || n <= 0) throw new Error(`invalid ${key}: ${raw}`)
  return n
}

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const appid = env.WX_APPID
  const secret = env.WX_SECRET
  return {
    port: readPositiveInt(env, 'PORT', 8080),
    heartbeatMs: readPositiveInt(env, 'HEARTBEAT_MS', 30000),
    turnMs: readPositiveInt(env, 'TURN_MS', 30000),
    capacity: readPositiveInt(env, 'ROOM_CAPACITY', 3),
    wx: appid && secret ? { appid, secret } : null,
  }
}
