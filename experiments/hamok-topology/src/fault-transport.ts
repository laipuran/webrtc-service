import { createExperimentNode, type ExperimentNode, type WirePacket } from './adapter';

export interface Delivery {
  sequence: number;
  at: number;
  source: string;
  target: string;
  bytes: number;
  action: 'deliver' | 'drop';
}

/** Async, serialized transport with symmetric partition groups. */
export function createFaultCluster(peerIds: string[], roomEpoch: string) {
  const nodes = new Map<string, ExperimentNode>();
  const deliveries: Delivery[] = [];
  let groups = [peerIds];
  let closed = false;
  function send(packet: WirePacket) {
    for (const target of peerIds) {
      if (target === packet.source || (packet.destination && packet.destination !== target)) continue;
      // Force an actual coordinator boundary, in addition to protobuf serialization.
      const copy: WirePacket = JSON.parse(JSON.stringify(packet));
      queueMicrotask(() => {
        if (closed) return;
        const connected = groups.some(group => group.includes(copy.source) && group.includes(target));
        deliveries.push({
          sequence: deliveries.length, at: Date.now(), source: copy.source, target,
          bytes: copy.bytes.length, action: connected ? 'deliver' : 'drop',
        });
        if (connected && !nodes.get(target)!.receive(copy)) {
          throw new Error(`Valid transport packet rejected: ${copy.source} -> ${target}`);
        }
      });
    }
  }
  for (const peerId of peerIds) {
    nodes.set(peerId, createExperimentNode({ peerId, roomEpoch, initialVoters: peerIds, send }));
  }
  return {
    nodes,
    deliveries,
    async start() { await Promise.all([...nodes.values()].map(node => node.start())); },
    partition(partitions: string[][]) {
      if ([...partitions.flat()].sort().join(',') !== [...peerIds].sort().join(',')) {
        throw new Error('Partition must cover every peer exactly once');
      }
      groups = partitions.map(group => [...group]);
      nodes.forEach(node => node.sample(`partition:${JSON.stringify(groups)}`));
    },
    states: () => [...nodes.values()].map(node => node.state()),
    close() { closed = true; nodes.forEach(node => node.close()); },
  };
}

export const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export async function waitFor(predicate: () => boolean, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`Condition not reached within ${timeoutMs}ms`);
    await sleep(25);
  }
}
