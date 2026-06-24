import type { Card } from '../engine/paodekuai/card'
import type { DeckVariant } from '../engine/paodekuai/deck'

// 入站消息（已校验的判别联合）。出站复用 room 的 ServerMessage。
export type ClientMessage =
  | { type: 'AUTH'; code: string }
  | { type: 'CREATE'; roomId: string; variant: DeckVariant }
  | { type: 'JOIN'; roomId: string }
  | { type: 'PLAY'; cards: Card[] }
  | { type: 'PASS' }
  | { type: 'RESUME' }

export type ParseResult =
  | { ok: true; msg: ClientMessage }
  | { ok: false; reason: 'BAD_MESSAGE' }

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

export function parseClientMessage(raw: string): ParseResult {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return { ok: false, reason: 'BAD_MESSAGE' }
  }
  if (!isObject(data) || typeof data['type'] !== 'string') return { ok: false, reason: 'BAD_MESSAGE' }
  const payload = isObject(data['payload']) ? data['payload'] : {}
  const type = data['type']

  switch (type) {
    case 'AUTH': {
      const code = payload['code']
      if (typeof code !== 'string') return { ok: false, reason: 'BAD_MESSAGE' }
      return { ok: true, msg: { type: 'AUTH', code } }
    }
    case 'CREATE': {
      const roomId = payload['roomId']
      if (typeof roomId !== 'string') return { ok: false, reason: 'BAD_MESSAGE' }
      const rawVariant = payload['variant']
      // 体验版宽松：variant 缺失或无法识别一律回落 classic16，不报 BAD_MESSAGE
      const variant: DeckVariant = rawVariant === 'classic15' ? 'classic15' : 'classic16'
      return { ok: true, msg: { type: 'CREATE', roomId, variant } }
    }
    case 'JOIN': {
      const roomId = payload['roomId']
      if (typeof roomId !== 'string') return { ok: false, reason: 'BAD_MESSAGE' }
      return { ok: true, msg: { type: 'JOIN', roomId } }
    }
    case 'PLAY': {
      const cards = payload['cards']
      if (!Array.isArray(cards)) return { ok: false, reason: 'BAD_MESSAGE' }
      return { ok: true, msg: { type: 'PLAY', cards: cards as Card[] } }
    }
    case 'PASS':
      return { ok: true, msg: { type: 'PASS' } }
    case 'RESUME':
      return { ok: true, msg: { type: 'RESUME' } }
    default:
      return { ok: false, reason: 'BAD_MESSAGE' }
  }
}
