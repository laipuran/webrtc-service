import { describe, expect, it } from 'vitest'

import {
  encodeClientMessage,
  parseServerMessage,
  type ClientMessage,
  type ServerMessage,
} from './protocol'

describe('encodeClientMessage', () => {
  it('encodes a Join request as JSON with a type discriminant', () => {
    const message: ClientMessage = {
      type: 'Join',
      room_id: 'room-1',
      auth: 'secret',
      username: 'duck',
    }

    const encoded = encodeClientMessage(message)

    expect(JSON.parse(encoded)).toEqual(message)
  })

  it('encodes a Signal request with a nested signal', () => {
    const message: ClientMessage = {
      type: 'Signal',
      to: 'member-2',
      signal: { type: 'Offer', sdp: 'v=0' },
    }

    expect(JSON.parse(encodeClientMessage(message))).toEqual(message)
  })
})

describe('parseServerMessage', () => {
  it('parses a Joined message', () => {
    const raw = JSON.stringify({
      type: 'Joined',
      member_id: 'member-1',
      room_id: 'room-1',
    })

    const message: ServerMessage = parseServerMessage(raw)

    expect(message).toEqual({
      type: 'Joined',
      member_id: 'member-1',
      room_id: 'room-1',
    })
  })

  it('parses a Signal message with a nested Offer', () => {
    const raw = JSON.stringify({
      type: 'Signal',
      from: 'member-1',
      signal: { type: 'Offer', sdp: 'v=0' },
    })

    const message = parseServerMessage(raw)

    expect(message.type).toBe('Signal')
    if (message.type === 'Signal') {
      expect(message.signal).toEqual({ type: 'Offer', sdp: 'v=0' })
    }
  })

  it('parses a Roster message', () => {
    const raw = JSON.stringify({
      type: 'Roster',
      members: [{ member_id: 'member-1', username: 'duck' }],
    })

    expect(parseServerMessage(raw)).toEqual({
      type: 'Roster',
      members: [{ member_id: 'member-1', username: 'duck' }],
    })
  })

  it('throws on malformed JSON', () => {
    expect(() => parseServerMessage('not json')).toThrow()
  })

  it('throws on an unknown message type', () => {
    expect(() => parseServerMessage(JSON.stringify({ type: 'Bogus' }))).toThrow()
  })
})
