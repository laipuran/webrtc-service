import { describe, expect, it } from 'vitest'

import type { MemberSummary } from '../protocol'
import { isPolite, selectDepartedMembers, selectNewMembers } from './mesh'

const alice: MemberSummary = { member_id: 'alice', username: 'Alice' }
const bob: MemberSummary = { member_id: 'bob', username: 'Bob' }
const carol: MemberSummary = { member_id: 'carol', username: 'Carol' }

describe('isPolite', () => {
  it('gives opposite roles to the two sides of a pair', () => {
    expect(isPolite('alice', 'bob')).toBe(true)
    expect(isPolite('bob', 'alice')).toBe(false)
  })

  it('is deterministic regardless of call order', () => {
    expect(isPolite('alice', 'bob')).toBe(isPolite('alice', 'bob'))
  })
})

describe('selectNewMembers', () => {
  it('returns roster members we have no connection to yet', () => {
    expect(selectNewMembers(['alice'], [alice, bob, carol], 'alice')).toEqual([
      bob,
      carol,
    ])
  })

  it('excludes ourselves even before any connection exists', () => {
    expect(selectNewMembers([], [alice, bob], 'alice')).toEqual([bob])
  })

  it('returns nothing when everyone is already known', () => {
    expect(selectNewMembers(['alice', 'bob'], [alice, bob], 'alice')).toEqual([])
  })
})

describe('selectDepartedMembers', () => {
  it('returns known members who are no longer in the roster', () => {
    expect(selectDepartedMembers(['alice', 'bob', 'carol'], [alice])).toEqual([
      'bob',
      'carol',
    ])
  })

  it('returns nothing when everyone is still present', () => {
    expect(selectDepartedMembers(['alice', 'bob'], [alice, bob])).toEqual([])
  })
})
