import { describe, expect, it } from 'vitest';
import { applications, assess, isObservedNoLeaderError } from './browser-evidence';
import type { TraceEvent } from './adapter';

function event(peer: string, digest: string): Extract<TraceEvent, { kind: 'replicated-application' }> {
  return { sequence: 0, at: 1, elapsedMs: 1, kind: 'replicated-application',
    detail: { index: 1, requestId: 'test', entries: { currentDecision: { revision: 1, digest } } },
    state: { peerId: peer, roomEpoch: 'test', initialVoters: ['a', 'b', 'c', 'd'],
      actualVoters: [peer], term: 1, leader: peer, role: 'leader', commitIndex: 1,
      nextIndex: 2, firstIndex: 0, highestSeenMapCommitIndex: 1,
      entries: { currentDecision: { revision: 1, digest } } } };
}
describe('browser evidence safety is independent of mechanics', () => {
  it('only separates the exact native no-leader outcome from harness errors', () => {
    const outcome: Extract<TraceEvent, { kind: 'error' }> = { ...event('a', 'left'), kind: 'error',
      detail: 'Error: No leader is elected, cannot submit message type 56' };
    expect(isObservedNoLeaderError(outcome)).toBe(true);
    outcome.detail = 'Error: Unexpected failure';
    expect(isObservedNoLeaderError(outcome)).toBe(false);
  });
  it('does not label silence or snapshots safe refusal', () => {
    expect(assess('two-disconnected', [['a'], ['b']], []).outcome).toBe('unknown');
    expect(applications([
      { ...event('a', 'left'), kind: 'snapshot-import', detail: { serialized: '{}' } },
      { ...event('a', 'left'), kind: 'write-ack', detail: { key: 'currentDecision', value: { revision: 1, digest: 'left' } } },
    ])).toEqual([]);
  });
  it('recognizes indexed split applications and minority progress', () => {
    expect(assess('four-two-two', [['a', 'b'], ['c', 'd']], [event('a', 'left'), event('c', 'right')]).outcome).toBe('unsafe');
    expect(assess('four-two-two', [['a', 'b'], ['c', 'd']], [event('a', 'left')]).outcome).toBe('unsafe');
  });
  it('requires post-handler contents, not just a request', () => {
    const request = event('a', 'left');
    request.state.entries = {};
    expect(applications([request])).toEqual([]);
  });
  it.each([-1, 0.5, NaN, Infinity])('rejects invalid application position %s', index => {
    const request = event('a', 'left');
    request.detail.index = index;
    expect(applications([request])).toEqual([]);
  });
  it.each([{ revision: 2, digest: 'left' }, { revision: 1, digest: 'right' }])('rejects mismatched post-handler content %j', value => {
    const request = event('a', 'left');
    request.state.entries.currentDecision = value;
    expect(applications([request])).toEqual([]);
  });
  it('accepts index zero and matching post-handler content', () => {
    const request = event('a', 'left');
    request.detail.index = 0;
    expect(applications([request])).toMatchObject([{ index: 0, value: { revision: 1, digest: 'left' } }]);
  });
});
