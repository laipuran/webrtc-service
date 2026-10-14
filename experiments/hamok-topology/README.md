# Native Hamok topology-control experiment

**Strong-consistency integration is stopped.** T1 already observed native four-node 2+2 conflicting indexed applications. This package contains evidence collection and an independent pure planner, not a topology publisher. See [AUDIT.md](AUDIT.md) for pinned-source semantics and [REPORT.md](REPORT.md) for browser results and limitations.

## Reproduce locally

Use Node 22.12+ (the recorded run uses Node 24). From `experiments/hamok-topology/`:

```sh
npm ci
npx playwright install chromium
npm test
npm run typecheck
npm run build
npm run build:page
npm run run:browser
npm run gate:browser -- --input=artifacts/browser-matrix.json
```

On systems missing browser OS libraries, install Playwright's documented system dependencies (`npx playwright install --with-deps chromium`, requiring system privileges). The pinned `@playwright/test@1.64.0` selects its actual Chromium build; neither an external temporary experiment nor a system Chrome executable is used. The default Playwright cache is supported but not required.

`run:browser` creates a local Vite server on `127.0.0.1` with an ephemeral port and file watching/HMR disabled, launches one native node in each separate Chromium browser context/page, and closes both browser and server afterward. No remote server, DataChannel, media, Raft patch, or planner integration is involved. The six-case matrix normally takes roughly four minutes. Each scenario has a **90s watchdog**, including context/page creation and all browser operations. Initialization, sampling, packet reception and other operations have 10s limits; native startup has 15s and proposals have 8s. Observation waits also share the remaining scenario budget. Page errors, console messages, adapter traces, exact timings, original/actual voter sets, positions, proposal results, snapshots, and packet bytes are recorded in ignored `artifacts/browser-matrix.json`.

Teardown closes contexts directly, without evaluating page JavaScript. Context closure and routing-queue drainage run concurrently with 3s limits; failure escalates to browser closure for at most another 3s, then kills the owned Chromium process if closure stalls. Thus scenario work plus teardown is bounded at 96s, rather than depending on a responsive renderer. Timeout/teardown errors remain in the artifact with `completed=false`; neither mechanics nor the safety gate can pass them. Final browser/server shutdown also has 3s limits. The tests include real never-resolving page initialization, incomplete-artifact/nonzero-gate verification, and stalled teardown fallback.

`run:browser` exits zero only for completed mechanics without harness/unexpected errors, with indexed baseline replication on every node and stable-case revision-1 replication. An observed safety counterexample can satisfy mechanics. The exact native “No leader is elected, cannot submit message type 56” error is preserved as a partition outcome (`nativeErrors`), not hidden or classified as safe refusal; it does not invalidate routing mechanics. Any other adapter error, pageerror, console error, or routing rejection fails mechanics. `gate:browser` exits nonzero on unsafe, unknown, incomplete, or erroneous evidence, including native no-leader errors.

With `--input`, the gate evaluates the existing local artifact rather than rerunning browsers; without it, it runs the full matrix again. Input artifacts are trusted local experiment records, not authenticated evidence from third parties. The gate recomputes application assessments rather than trusting their saved outcome labels. No lack of progress is classified as safe refusal.

## Recorded fault schedule and evidence

Seed `20261014` identifies the fixed scenario/fault schedule. Native election randomness is **unseeded** and browser scheduling is not deterministic. Each fresh scenario injects the same initial roster and a scenario-specific epoch. This is bootstrap configuration, not a guarantee that native Hamok keeps voters fixed. After indexed baseline revision 0 reaches every node, a symmetric partition blocks every cross-group protobuf packet for 33,000ms before side-specific revision-1 proposals. The dedicated old-leader case identifies the actual pre-fault leader and isolates that node, rather than assuming `a` is leader. Group-local leaders propose where observed; otherwise the first group member requests a write.

The coordinator binds sending identity to the actual Playwright page, validates JSON-safe metadata/bytes and epoch, routes explicit destinations exactly once, and broadcasts only to other initial peers. Per-receiver queues preserve delivery ordering and recheck the partition at delivery. Transport records include sender/receiver context identity, packet bytes, enqueue/drop time, and delivery time. The native adapter additionally verifies decoded protobuf source/destination and epoch. This is trusted experimental provenance, not Byzantine authentication.

Indexed post-handler `replicated-application` records establish Map application evidence. Node and browser use the same environment-independent decoder, requiring a nonnegative integer index and matching post-handler revision/digest; trace kinds and payloads are typed together. `write-request`, acknowledgements, snapshot imports, and generic Map events do not substitute for that evidence. A proposal observation deadline is unknown and does not cancel native work; a scenario failure stops observation and destroys its contexts. Every partition exceeds the 800ms election/removal, 500ms follower idle, 50ms heartbeat, and hard-coded 30s unsynced window. **Waiting alone does not activate unsynced removal**: the native path requires a follower behind the first retained log index. Default 300s expiry remains unchanged; expired-log recovery is not tested. See the small tracked [sample](samples/browser-summary.json); the full artifact stays ignored.
