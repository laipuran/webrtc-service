import { HAMOK_VERSION, TIMING } from './adapter';
import { createFaultCluster, sleep, waitFor } from './fault-transport';
import { applications as decodeApplications } from './application-evidence';

export async function runPartitionBaseline() {
  const cluster = createFaultCluster(['a', 'b', 'c', 'd'], 'node-four-way-epoch-1');
  try {
    await cluster.start();
    await waitFor(() => new Set(cluster.states().map(state => state.leader)).size === 1
      && cluster.states().every(state => state.leader !== null));
    await cluster.nodes.get('a')!.propose({ revision: 0, digest: 'initial' });
    await waitFor(() => cluster.states().every(state => state.entries.currentDecision?.digest === 'initial'));
    const before = cluster.states();
    // Both halves lack the majority (3) of the original four-voter roster.
    cluster.partition([['a', 'b'], ['c', 'd']]);
    await sleep(TIMING.partitionObservationInMs);
    const partitioned = cluster.states();
    const writes = await Promise.all([
      cluster.nodes.get('a')!.propose({ revision: 1, digest: 'left' }),
      cluster.nodes.get('c')!.propose({ revision: 1, digest: 'right' }),
    ]);
    await sleep(500);
    const applications = decodeApplications([...cluster.nodes.values()].flatMap(node => node.trace()));
    const conflicting = applications.filter(item => item.value.revision === 1);
    const digests = new Set(conflicting.map(item => item.value.digest));
    const errors = [...cluster.nodes.values()].flatMap(node => node.trace())
      .filter(event => ['error', 'receive-error', 'unindexed-map-request'].includes(event.kind));
    const unknown = writes.some(write => write.outcome === 'unknown');
    return {
      version: HAMOK_VERSION,
      seed: 'none: native election randomness; deterministic partition schedule',
      timing: TIMING,
      scenario: 'four nodes 2+2, same epoch/revision conflicting content',
      before, partitioned, writes, after: cluster.states(),
      mechanismPassed: !unknown && errors.length === 0 && digests.has('left') && digests.has('right')
        && cluster.states().every(state => state.entries.currentDecision?.revision === 1),
      // This counterexample probe cannot prove safe refusal. No observation is inconclusive.
      safetyGatePassed: false,
      safetyGateStatus: conflicting.length > 0 ? 'fail-observed-application-without-original-majority'
        : 'inconclusive-no-positive-refusal-evidence',
      applications,
      traces: Object.fromEntries([...cluster.nodes].map(([id, node]) => [id, node.trace()])),
      deliveries: cluster.deliveries,
    };
  } finally {
    cluster.close();
  }
}
