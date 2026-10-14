import { describe, expect, it } from 'vitest';
import { HamokMessage } from 'hamok';
import { createExperimentNode } from './adapter';
import { createFaultCluster, waitFor } from './fault-transport';

describe('native Hamok experiment adapter', () => {
  it('round-trips actual protobuf with binary fields and nested messages', () => {
    const message = new HamokMessage({
      sourceId: 'a', destinationId: 'b',
      keys: [Uint8Array.from([0, 255, 128])],
      values: [Uint8Array.from([7, 0, 250])],
      embeddedMessages: [new HamokMessage({ sourceId: 'nested', raftTerm: 7 })],
    });
    const bytes = message.toBinary();
    expect(HamokMessage.fromBinary(bytes).equals(message)).toBe(true);
    expect(bytes).toBeInstanceOf(Uint8Array);
  });

  it('rejects stale epochs and spoofed protobuf identities', () => {
    const node = createExperimentNode({ peerId: 'a', roomEpoch: 'new', initialVoters: ['a', 'b'], send() {} });
    try {
      const bytes = Array.from(new HamokMessage({ sourceId: 'b' }).toBinary());
      expect(node.receive({ protocolVersion: 1, roomEpoch: 'old', source: 'b', bytes })).toBe(false);
      expect(node.receive({ protocolVersion: 1, roomEpoch: 'new', source: 'b',
        bytes: Array.from(new HamokMessage({ sourceId: 'impostor' }).toBinary()) })).toBe(false);
      expect(node.state().commitIndex).toBe(-1);
    } finally { node.close(); }
  });

  it('replicates stable three-node writes with indexed application evidence', async () => {
    const cluster = createFaultCluster(['a', 'b', 'c'], 'stable-epoch');
    try {
      await cluster.start();
      expect(await cluster.nodes.get('b')!.propose({ revision: 1, digest: 'stable' }))
        .toEqual({ outcome: 'acknowledged' });
      await waitFor(() => cluster.states().every(state => state.entries.currentDecision?.digest === 'stable'));
      for (const node of cluster.nodes.values()) {
        expect(node.state().actualVoters).toEqual(['a', 'b', 'c']);
        expect(node.trace().some(event => event.kind === 'replicated-application'
          && (event.detail as { index: number }).index >= 0)).toBe(true);
      }
      expect(cluster.deliveries.some(delivery => delivery.bytes > 0)).toBe(true);
      expect([...cluster.nodes.values()].some(node => node.trace()
        .some(event => event.kind === 'snapshot-import'))).toBe(true);
      // An observation deadline does not cancel a native request or prove refusal.
      const leader = cluster.states()[0].leader!;
      const proposer = cluster.nodes.get(leader)!;
      cluster.partition([[leader], ['a', 'b', 'c'].filter(peer => peer !== leader)]);
      const result = await proposer.propose({ revision: 2, digest: 'late' }, 'currentDecision', 1);
      expect(result.outcome).toBe('unknown');
      cluster.partition([['a', 'b', 'c']]);
      await waitFor(() => cluster.states().every(state => state.entries.currentDecision?.digest === 'late'));
      expect(proposer.trace().some(event => event.kind === 'write-unknown')).toBe(true);
      expect(proposer.trace().some(event => event.kind === 'write-ack'
        && (event.detail as { value: { digest: string } }).value.digest === 'late')).toBe(true);
    } finally { cluster.close(); }
  });
});
