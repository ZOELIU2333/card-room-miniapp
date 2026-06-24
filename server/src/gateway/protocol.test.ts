import { describe, it, expect } from 'vitest'
import { parseClientMessage } from './protocol'

describe('parseClientMessage', () => {
  it('parses AUTH', () => {
    expect(parseClientMessage(JSON.stringify({ type: 'AUTH', payload: { code: 'abc' } })))
      .toEqual({ ok: true, msg: { type: 'AUTH', code: 'abc' } })
  })
  it('parses JOIN and CREATE', () => {
    expect(parseClientMessage(JSON.stringify({ type: 'JOIN', payload: { roomId: 'r1' } })))
      .toEqual({ ok: true, msg: { type: 'JOIN', roomId: 'r1' } })
    expect(parseClientMessage(JSON.stringify({ type: 'CREATE', payload: { roomId: 'r1' } })))
      .toEqual({ ok: true, msg: { type: 'CREATE', roomId: 'r1', variant: 'classic16' } })
  })
  it('parses CREATE with explicit classic15 variant', () => {
    expect(parseClientMessage(JSON.stringify({ type: 'CREATE', payload: { roomId: 'r1', variant: 'classic15' } })))
      .toEqual({ ok: true, msg: { type: 'CREATE', roomId: 'r1', variant: 'classic15' } })
  })
  it('parses CREATE with explicit classic16 variant', () => {
    expect(parseClientMessage(JSON.stringify({ type: 'CREATE', payload: { roomId: 'r1', variant: 'classic16' } })))
      .toEqual({ ok: true, msg: { type: 'CREATE', roomId: 'r1', variant: 'classic16' } })
  })
  it('defaults CREATE variant to classic16 when missing', () => {
    expect(parseClientMessage(JSON.stringify({ type: 'CREATE', payload: { roomId: 'r1' } })))
      .toEqual({ ok: true, msg: { type: 'CREATE', roomId: 'r1', variant: 'classic16' } })
  })
  it('falls back CREATE variant to classic16 when invalid (string)', () => {
    expect(parseClientMessage(JSON.stringify({ type: 'CREATE', payload: { roomId: 'r1', variant: 'classic99' } })))
      .toEqual({ ok: true, msg: { type: 'CREATE', roomId: 'r1', variant: 'classic16' } })
  })
  it('falls back CREATE variant to classic16 when invalid (number)', () => {
    expect(parseClientMessage(JSON.stringify({ type: 'CREATE', payload: { roomId: 'r1', variant: 42 } })))
      .toEqual({ ok: true, msg: { type: 'CREATE', roomId: 'r1', variant: 'classic16' } })
  })
  it('ignores stray variant on JOIN', () => {
    expect(parseClientMessage(JSON.stringify({ type: 'JOIN', payload: { roomId: 'r1', variant: 'classic15' } })))
      .toEqual({ ok: true, msg: { type: 'JOIN', roomId: 'r1' } })
  })
  it('parses PLAY with cards and PASS and RESUME', () => {
    expect(parseClientMessage(JSON.stringify({ type: 'PLAY', payload: { cards: [{ rank: '3', suit: 'D' }] } })))
      .toEqual({ ok: true, msg: { type: 'PLAY', cards: [{ rank: '3', suit: 'D' }] } })
    expect(parseClientMessage(JSON.stringify({ type: 'PASS', payload: {} })))
      .toEqual({ ok: true, msg: { type: 'PASS' } })
    expect(parseClientMessage(JSON.stringify({ type: 'RESUME', payload: {} })))
      .toEqual({ ok: true, msg: { type: 'RESUME' } })
  })
  it('rejects invalid JSON', () => {
    expect(parseClientMessage('not json{')).toEqual({ ok: false, reason: 'BAD_MESSAGE' })
  })
  it('rejects missing/unknown type', () => {
    expect(parseClientMessage(JSON.stringify({ payload: {} }))).toEqual({ ok: false, reason: 'BAD_MESSAGE' })
    expect(parseClientMessage(JSON.stringify({ type: 'NOPE', payload: {} }))).toEqual({ ok: false, reason: 'BAD_MESSAGE' })
  })
  it('rejects AUTH without code and JOIN without roomId', () => {
    expect(parseClientMessage(JSON.stringify({ type: 'AUTH', payload: {} }))).toEqual({ ok: false, reason: 'BAD_MESSAGE' })
    expect(parseClientMessage(JSON.stringify({ type: 'JOIN', payload: {} }))).toEqual({ ok: false, reason: 'BAD_MESSAGE' })
  })
})
