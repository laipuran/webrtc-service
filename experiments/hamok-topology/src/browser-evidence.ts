import type { TraceEvent, Proposal } from './adapter';

export function isObservedNoLeaderError(event: TraceEvent) {
  return event.kind === 'error'
    && event.detail === 'Error: No leader is elected, cannot submit message type 56';
}

export const SCENARIOS = [
  { name: 'stable-three', peers: ['a', 'b', 'c'], groups: null },
  { name: 'two-disconnected', peers: ['a', 'b'], groups: [['a'], ['b']] },
  { name: 'three-two-one', peers: ['a', 'b', 'c'], groups: [['a', 'b'], ['c']] },
  { name: 'four-two-two', peers: ['a', 'b', 'c', 'd'], groups: [['a', 'b'], ['c', 'd']] },
  { name: 'three-singletons', peers: ['a', 'b', 'c'], groups: [['a'], ['b'], ['c']] },
  { name: 'old-leader-isolated', peers: ['a', 'b', 'c'], groups: null },
] as const;

export function applications(events: TraceEvent[]) {
  return events.filter(event => event.kind === 'replicated-application').flatMap(event => {
    const detail = event.detail as { index: number; entries: Record<string, Proposal> };
    const value = detail.entries.currentDecision;
    return value && Number.isInteger(detail.index) && detail.index >= 0
      && event.state.entries.currentDecision?.digest === value.digest
      && event.state.entries.currentDecision?.revision === value.revision
      ? [{ peer: event.state.peerId, epoch: event.state.roomEpoch, at: event.at,
        elapsedMs: event.elapsedMs, index: detail.index, value, state: event.state }] : [];
  });
}

export function assess(name: string, groups: string[][], events: TraceEvent[]) {
  const applied = applications(events).filter(item => item.value.revision === 1);
  const majority = Math.floor(groups.flat().length / 2) + 1;
  const conflicts = new Set(applied.map(item => item.value.digest)).size > 1;
  const minorityApplication = name !== 'stable-three' && applied.some(item =>
    (groups.find(group => group.includes(item.peer))?.length ?? 0) < majority);
  // No proof of rejection API exists: absence of progress remains UNKNOWN.
  return { outcome: conflicts || minorityApplication ? 'unsafe' :
    name === 'stable-three' && groups.flat().every(peer => applied.some(item => item.peer === peer))
      ? 'observed-stable' : 'unknown', conflicts, minorityApplication, applications: applied };
}
