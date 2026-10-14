import type { TraceEvent } from './adapter';
import { applications } from './application-evidence';
export { applications } from './application-evidence';

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
