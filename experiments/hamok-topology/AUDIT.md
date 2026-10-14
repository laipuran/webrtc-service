# Hamok 2.6.0 native control-plane audit

**Stop the strong-consistency integration route on native Hamok.** The Node four-node 2+2 experiment observed conflicting replicated Map applications in the same epoch and revision. Continue only the isolated browser evidence and pure planner work. This package neither implements topology publication nor fixes the consensus engine.

## Reproduce the evidence

Run in `experiments/hamok-topology/` (Node 22.12+ or a Vite 8 supported newer Node):

```sh
npm ci
npm test
npm run typecheck
npm run build
npm run baseline
npm run gate:node
```

`test` asserts experiment mechanics, including the expected native counterexample. It is not a safety pass. `baseline` writes complete state, application, transport, and event evidence to ignored `artifacts/node-baseline.json`. `gate:node` repeats the probe and returns nonzero for the counterexample or an inconclusive/error outcome; absence of observed application does not prove safe refusal. No test changes production dependencies or code.

## Actual verification

Stable three-node Node replication passed on Node v24.20.0. Every node observed an indexed `replicated-application`; binary Hamok protobuf round-trips passed, including binary keys/values and nested messages. A 1ms adapter observation deadline returned unknown, followed by actual replication and a late acknowledgement, confirming that timeout is not refusal. Four tests pass across two files. Vite 8.2.2 compiled the browser library without Node-external warnings. **Compilation is not independent-browser runtime verification:** that belongs to T3.

The first Node partition run used epoch `node-four-way-epoch-1`, peers `a,b,c,d`, no seeded native election randomness, and a deterministic 2+2 fault schedule. After stable revision 0 replication, all cross-partition protobuf packets were dropped for 32,000ms before conflicting proposals. This exceeds heartbeat (50ms), follower idle (500ms), election/heartbeat removal (800ms), and native unsynced removal (30,000ms). Logs retain their default 300,000ms expiry, so this scenario does not exercise expired-log recovery or activate the unsynced path merely by waiting.

Observed application samples (elapsed values are illustrative evidence from that run, not timing assertions):

```json
[
  {"peer":"a","elapsedMs":35143,"term":1,"role":"leader","actualVoters":["a","b"],"index":1,"revision":1,"digest":"left"},
  {"peer":"b","elapsedMs":35193,"term":1,"role":"follower","actualVoters":["a","b"],"index":1,"revision":1,"digest":"left"},
  {"peer":"c","elapsedMs":35140,"term":2,"role":"leader","actualVoters":["c","d"],"index":1,"revision":1,"digest":"right"},
  {"peer":"d","elapsedMs":35190,"term":2,"role":"follower","actualVoters":["c","d"],"index":1,"revision":1,"digest":"right"}
]
```

Neither half has the original four-voter majority of three. The original leader remained active in one half. Both writes acknowledged and both conflicting values applied on both nodes in their respective halves. These observations do not depend on write acknowledgements alone or on eventual convergence.

## Source-derived membership and quorum semantics

Paths and lines below refer to the **published npm 2.6.0 package** under `node_modules/hamok/src`, not a floating GitHub branch. The lockfile pins its registry tarball integrity. No monkeypatch, listener removal, fixed-membership workaround, or fork is present.

| Published source | Finding |
|---|---|
| `Hamok.ts:469–503` | `addRemotePeerId` / `removeRemotePeerId` directly mutate `raft.remotePeers`; removal also deletes match/next positions and emits membership events. There is no replicated joint-consensus transition in these methods. |
| `Hamok.ts:362–366,1343–1365` | Native listeners connect `unsynced-peer` to removal. Leader heartbeat checking removes an observed peer after `electionTimeoutInMs`, not a separate heartbeat timeout. |
| `Hamok.ts:505–533` | Losing the known leader clears remote peers and starts native rejoin with a hard-coded 5s fetch timeout and infinite retries. |
| `Hamok.ts:1094–1109,1122–1150` | JOIN discovery adds peers; endpoint notifications remove missing active peers and add advertised peers. Initial roster injection therefore is not a fixed-configuration guarantee. |
| `raft/RaftCandidateState.ts:62–89` | Election threshold is `remotePeers.size + 1 < receivedVotes.size * 2`; the set is local and mutable. |
| `raft/RaftLeaderState.ts:110–142` | Current-term entries commit when `remotePeers.size + 1 < matchCount * 2`, counting the leader. The threshold shrinks with the mutable set. |
| `raft/RaftLeaderState.ts:170–175,197–214` | No-remote leader becomes follower. A peer behind `logs.firstIndex` for over hard-coded 30s emits `unsynced-peer`. This does not establish isolated single-node commit behavior. |
| `raft/RaftLogs.ts:19–38`, `raft/SyncedProperties.ts` | Logs expose memory indices/replacement/reset APIs; this experiment has no durable term, vote, log or application-state persistence. |

The adapter admits only the initial roster at its transport boundary to avoid unrelated discovery contamination. That restriction does **not** prevent native shrinking or rejoining within that roster and does not claim Byzantine sender authentication. The coordinator controls routing and epoch injection, not elections or topology.

## Map events, applied positions and snapshots

`Hamok.ts:456–466` routes a native Raft `commit` through `accept(message, commitIndex)`. Both leader and follower states emit indexed commits. `collections/HamokConnection.ts:209–264` buffers messages until storage join, ignores old/equal indexed messages, then updates its applied marker before decoding/emitting the storage request. `highestSeenCommitIndex` is the public getter for this marker; it is not a durable application receipt or a guarantee that all lower global indices concern this Map.

`collections/HamokMap.ts:140–174` synchronously applies an `UpdateEntriesRequest` and emits `insert`/`update`. Our listener on that same connection request is registered **after** the Map's own listener. Its `replicated-application` observation therefore records post-handler contents and the exact request commit index, including buffered replay. An unindexed request is explicitly labeled separately. This is evidence of native replicated application, not authorization to publish a globally accepted topology: membership safety has failed.

Map `insert`/`update` alone are insufficient evidence. `HamokMap.ts:177–205,461–464` exports/imports snapshots and can also emit these events during noninitial snapshot import; initialization suppresses snapshot mutation events. The adapter separately traces `snapshot-import` after the synchronous import handler and a microtask `snapshot-position-observation`. `HamokConnection.ts:818–833` updates the received remote applied index after snapshot completion. A snapshot import can change contents without a new local Raft application and its associated marker is not a fresh commit proof.

The generic `raft-commit` trace is registered after Hamok's internal routing listener, so a `replicated-application` may precede its corresponding `raft-commit` trace. Do not infer protocol order from our listener registration order. Use the explicit application index and node state. A write request, acknowledgement, indexed application and snapshot observation remain separate trace kinds. Failed or observation-deadline writes return **unknown**, never proof of rejection; deadline expiry does not cancel native work and late ack/application remains observable.

## API for T3 independent browsers

Import `src/adapter.ts`, or built ESM `dist/adapter.js`. Vite config explicitly bundles `events@3.3.0`; `src/polyfills.ts` supplies `Buffer@6.0.3` and a microtask-backed `process.nextTick` only when missing. Actual package source uses Buffer in codecs/snapshot conversion and nextTick in HamokEmitter. No full process shim is added. This library-mode Vite build is intentionally page-independent; T3 can add its own HTML/browser coordinator entry and extend the build configuration.

```ts
const node = createExperimentNode({
  peerId: 'a', roomEpoch: 'shared-epoch', initialVoters: ['a', 'b', 'c'],
  send: packet => coordinatorRoute(packet),
  onTrace: event => coordinatorRecord(event),
});
await node.start();
node.receive(packet); // returns false for stale epoch, identity mismatch, invalid bytes, etc.
await node.propose({ revision: 1, digest: 'candidate' });
node.sample('after partition');
node.state();
node.trace();
node.close();
```

`WirePacket` is JSON-safe metadata plus a number-array protobuf payload produced by `HamokMessage.toBinary()` and consumed by `HamokMessage.fromBinary()`. Route explicit destinations once; broadcast missing destinations to other initial peers only. Preserve the packet across the Playwright/page boundary rather than passing library objects. `propose(value, key?, timeoutMs?)` defaults to single key `currentDecision` and a 5s observation deadline. It offers no CAS, digest verification, business revision ordering or retry idempotency. Nodes expose term, leader, role, original and actual voters, global commit/first/next indices, Map highest-seen index, contents, and event timeline.

T3 must bound startup externally: native join/rejoin retries are not a reliable finite-failure API. It must collect actual application evidence on every side even when a proposal returns unknown. The Node helper `src/fault-transport.ts` handles symmetric partition groups, asynchronous delivery and serialization only; browser matrix routing/fault scheduling is T3-owned. Vitest includes `src/**/*.test.ts`, so T2 planner tests join without editing planner files.

## Unknowns and boundaries

Independent Chromium execution, 2-node disconnect, 3-node 2+1 and 1+1+1 scenarios, a dedicated 3-node old-leader isolation scenario, refresh/background pauses, expired-log snapshots and reconnection are not verified by T1. Browser polyfills preserve required call shapes but cannot reproduce Node scheduling or prevent browser throttling. Trace and transport logs are intentionally unbounded in this small trusted experiment. Messages are size-limited at receive; this is not production backpressure or authentication.

`npm audit` reported three findings at install: low esbuild Windows development-server file-read advisory (GHSA-g7r4-m6w7-qqqr), and moderate uuid/Hamok transitive buffer-bounds advisory (GHSA-w5hq-g745-h8pq). Published Hamok uses uuid v4, while the stated uuid advisory concerns v3/v5/v6 with supplied buffers; this is source context, not a blanket security clearance. The pinned experiment does not automatically upgrade/fork Hamok. Keep dev servers local and do not deploy this package as a service.
