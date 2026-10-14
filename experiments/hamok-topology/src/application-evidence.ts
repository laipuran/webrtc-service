import type { TraceEvent } from './adapter';

/** A request counts only at a valid position with matching post-handler contents. */
export function applications(events: TraceEvent[]) {
  return events.flatMap(event => {
    if (event.kind !== 'replicated-application') return [];
    const { index, entries } = event.detail;
    const value = entries.currentDecision;
    return value && Number.isInteger(index) && index >= 0
      && event.state.entries.currentDecision?.digest === value.digest
      && event.state.entries.currentDecision?.revision === value.revision
      ? [{ peer: event.state.peerId, epoch: event.state.roomEpoch, at: event.at,
        elapsedMs: event.elapsedMs, index, value, state: event.state }] : [];
  });
}
