import { describe, expect, it } from 'vitest';
import { applications, assess, isObservedNoLeaderError } from './browser-evidence';
import type { TraceEvent } from './adapter';

function event(peer: string, digest: string, kind = 'replicated-application'): TraceEvent {
  return { sequence: 0, at: 1, elapsedMs: 1, kind,
    detail: { index: 1, entries: { currentDecision: { revision: 1, digest } } },
    state: { peerId: peer, roomEpoch: 'test', initialVoters: ['a', 'b', 'c', 'd'],
      actualVoters: [peer], term: 1, leader: peer, role: 'leader', commitIndex: 1,
      nextIndex: 2, firstIndex: 0, highestSeenMapCommitIndex: 1,
      entries: { currentDecision: { revision: 1, digest } } } };
}
describe('browser evidence safety is independent of mechanics', () => {
  it('only separates the exact native no-leader outcome from harness errors', () => {
    const outcome = event('a', 'left', 'error');
    outcome.detail = 'Error: No leader is elected, cannot submit message type 56';
    expect(isObservedNoLeaderError(outcome)).toBe(true);
    outcome.detail = 'Error: Unexpected failure';
    expect(isObservedNoLeaderError(outcome)).toBe(false);
  });
  it('does not label silence or snapshots safe refusal', () => {
    expect(assess('two-disconnected', [['a'], ['b']], []).outcome).toBe('unknown');
    expect(applications([event('a', 'left', 'snapshot-import'), event('a', 'left', 'write-ack')])).toEqual([]);
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
});
