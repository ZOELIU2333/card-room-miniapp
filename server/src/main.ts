import { loadConfig } from './config'
import { createServer } from './composition'

const config = loadConfig(process.env)
const server = createServer(config)

const authMode = config.wx ? 'wechat' : 'stub'
console.log(`[run-entry] listening on :${config.port} (auth=${authMode}, capacity=${config.capacity})`)

let shuttingDown = false
async function onSignal(sig: string): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`[run-entry] received ${sig}, shutting down`)
  await server.shutdown()
  console.log('[run-entry] shutdown complete')
  process.exit(0)
}

process.on('SIGINT', () => void onSignal('SIGINT'))
process.on('SIGTERM', () => void onSignal('SIGTERM'))
