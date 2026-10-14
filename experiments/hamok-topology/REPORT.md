# Browser control-plane route decision

**Stop native Hamok strong-consistency topology integration.** T1's indexed 2+2 application counterexample already blocks that route. T3 adds real independent Chromium contexts and a matrix, without modifying the adapter, planner, native Raft, or production code. Successful mechanics are not a safety pass. Models A/B, fixed-configuration forks, DataChannel and media integration remain out of scope.

## Actual verification

The isolated package's **25 tests across four files pass**, including T1 native replication/partition tests, T2 planner tests, and browser-evidence classification tests. `npm ci`, pinned Playwright Chromium installation, TypeScript checking, the adapter library build, and the browser-page build pass with Vite 8.2.2. The final full matrix ran on Node v24.20.0, `@playwright/test@1.64.0`, Chromium **156.0.8078.4** (Playwright cache build 1248), seed `20261014`, with unseeded native elections. `npm run run:browser` exited **0**; `npm run gate:browser -- --input=artifacts/browser-matrix.json` reused that artifact and exited **1**, with `mechanics=true, safetyGate=false`.

Every node first applied indexed baseline revision 0. All six scenarios completed with zero pageerrors, console errors, routing rejections, or unexpected adapter errors. Console warnings were retained, including election/rejoin diagnostics. Seven exact native no-leader submission errors were retained separately as observed outcomes; they block safety, but do not mean the coordinator failed. Every partition waited more than 32s before its proposals. The final matrix took about 235s:

| Scenario | Partition wait (ms, coordinator monotonic clock) | Indexed revision-1 applications | Safety outcome |
|---|---:|---|---|
| Stable three | — | `a,b,c`: `side-0` | Observed stable, not a safety proof |
| Two disconnected | 33000.366078 | None; both requests unknown | Unknown, not safe refusal |
| Three 2+1 (`ab / c`) | 33001.284139 | `a,b`: `side-0`; `c` unknown | Unknown |
| Four 2+2 (`ab / cd`) | 32999.936793 | `a,b`: `side-0`; `c,d`: `side-1` | **Unsafe** |
| Three 1+1+1 | 33000.642131 | None; all requests unknown | Unknown, not safe refusal |
| Actual old leader isolated (`b / ac`) | 33000.827407 | `a,c`: `side-1`; old `b` unknown | Unknown |

The four-node witness uses epoch `browser-20261014-four-two-two`, original voters `a,b,c,d`, revision 1 and indexed application position **1** on both sides. Original majority is three; neither two-node half has it. Both proposals acknowledged, but the conclusion depends on the following post-handler application records, not acknowledgements:

| Peer | Per-node elapsed ms | Term | Role | Actual voters | Applied digest |
|---|---:|---:|---|---|---|
| c | 39007 | 1 | leader (original leader) | c,d | side-1 |
| b | 39011 | 2 | leader | a,b | side-0 |
| d | 39047 | 1 | follower | c,d | side-1 |
| a | 39050 | 2 | follower | a,b | side-0 |

All final Map contents agree with those indexed applications. Separately, this scenario recorded four **empty startup snapshot imports**, at per-node elapsed 5743–5777ms with highest-seen Map position -1. Those imports preceded baseline and conflicting writes; they do not explain the conflict and are not counted as applications. The whole matrix recorded 18 empty startup imports and zero `unsynced-peer` events. We observed snapshot instrumentation at startup, **not** nonempty snapshot recovery. Application elapsed times use each adapter's start time; fault/transport times use the coordinator's monotonic clock. They are observations, not deterministic timing assertions.

The complete artifact is ignored; [samples/browser-summary.json](samples/browser-summary.json) retains a compact witness, matrix outcomes and its SHA-256. A preliminary run was invalidated by a Vite configuration reload during 2+1 and correctly exited nonzero. File watching/HMR were then disabled. A subsequent completed run conservatively classified native no-leader errors as mechanics errors; their explicit outcome classification was added without changing the adapter or library. The final run above was a fresh full matrix under that classification, not a relabeled failed run.

## Source evidence is not runtime evidence

The pinned published `hamok@2.6.0` source and event ordering are audited in [AUDIT.md](AUDIT.md). `Hamok.ts:469–503,1343–1365` directly changes local remote voter sets on removal and heartbeat loss. `raft/RaftCandidateState.ts:62–89` and `raft/RaftLeaderState.ts:110–142` calculate election/commit thresholds from those mutable sets. The coordinator's initial roster injection does not neutralize those paths. These findings explain a risk, but source reading alone is not the browser counterexample.

`Hamok.ts:456–466`, `collections/HamokConnection.ts:209–264`, and `collections/HamokMap.ts:140–174` support the adapter's post-handler indexed application evidence. Snapshot imports (`HamokMap.ts:177–205,461–464`; `HamokConnection.ts:818–833`) are traced separately; neither snapshot contents nor write acknowledgements prove a new local indexed application. The classification tests explicitly exclude both. Generic Map insert/update is not sufficient evidence.

Every partition waits 33s, beyond the configured 50ms heartbeat, 500ms follower idle, 800ms election/heartbeat removal and native 30s unsynced interval. `raft/RaftLeaderState.ts:197–214` requires a follower behind `logs.firstIndex` before the unsynced timer/removal applies; elapsed time alone does not exercise that condition. Default log expiry is 300s. This matrix observes native heartbeat/membership changes but does not claim expired-log or unsynced recovery coverage.

## Unknowns and next-route boundary

No progress, a deadline, a native request failure, or a single observed digest cannot establish safe refusal. The adapter has no proven authoritative rejection API; partition outcomes lacking a counterexample remain **unknown**, and the safety gate returns nonzero. Finite runs are not a proof even for the stable case. The seed records a repeatable fault script, not deterministic elections, OS scheduling, or browser execution.

This is trusted local protobuf routing, not WebRTC, malicious-sender security, or real media-delay measurement. Background throttling, refresh and durable hard state, log expiry/snapshot recovery, delayed/duplicate/reordered packets, reconnection, and safe membership change are unknown. Snapshot event instrumentation exists, but this matrix does not force snapshot recovery. Browser contexts isolate page/storage state, not necessarily OS processes; one native node runs in each context.

The pure planner can remain an isolated algorithm baseline. Further strong-consistency work requires a separately authorized consensus choice or a bounded fork with fixed/safely replicated membership, persistence, and new safety tests. An explicit partition-autonomy design would change the business invariant and must use distinct scopes/epochs; conflict detection or eventual convergence does not repair the same-epoch safety violation. No such route is implemented here.

Reproduction and expected command exit meanings are in [README.md](README.md). The gate may evaluate the same full browser artifact via `--input`; that is evidence reuse, not a second independent browser run. Package audit still reports one low and two moderate inherited findings; see AUDIT.md. The dev server binds only `127.0.0.1`, and the experiment must not be deployed as a service.
