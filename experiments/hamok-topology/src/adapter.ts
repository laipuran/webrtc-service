import './polyfills';
import { Hamok, HamokMessage, setHamokLogLevel } from 'hamok';

setHamokLogLevel('error');

export const HAMOK_VERSION = '2.6.0';
export const TIMING = {
  heartbeatInMs: 50,
  electionTimeoutInMs: 800,
  followerMaxIdleInMs: 500,
  requestTimeoutInMs: 2_000,
  // Native source has an unconfigurable 30s unsynced-peer removal window.
  unsyncedRemovalInMs: 30_000,
  partitionObservationInMs: 32_000,
  logEntriesExpirationTimeInMs: 300_000,
} as const;

export interface Proposal {
  revision: number;
  digest: string;
  [key: string]: unknown;
}

/** JSON-safe coordinator envelope; bytes are protobuf, never JSON Hamok fields. */
export interface WirePacket {
  protocolVersion: 1;
  roomEpoch: string;
  source: string;
  destination?: string;
  bytes: number[];
}

export interface NodeState {
  peerId: string;
  roomEpoch: string;
  initialVoters: string[];
  actualVoters: string[];
  term: number;
  leader: string | null;
  role: string;
  commitIndex: number;
  nextIndex: number;
  firstIndex: number;
  highestSeenMapCommitIndex: number;
  entries: Record<string, Proposal>;
}

interface TraceDetails {
  error: string;
  'receive-error': string;
  'state-changed': { role: string; previous: string };
  'leader-changed': { leader: string | undefined; previous: string | undefined };
  'remote-peer-joined': string;
  'remote-peer-left': string;
  'no-heartbeat-from': string;
  'unsynced-peer': string;
  rejoining: null;
  'raft-commit': { index: number; requestId?: string; storageId?: string; type?: number };
  'map-insert': { key: string; value: Proposal };
  'map-update': { key: string; previous: Proposal; value: Proposal };
  'replicated-application': { index: number; requestId: string; entries: Record<string, Proposal> };
  'unindexed-map-request': { index: null; requestId: string; entries: Record<string, Proposal> };
  'snapshot-import': { serialized: string };
  'snapshot-position-observation': null;
  bootstrap: { hamokVersion: string; timing: typeof TIMING };
  joined: null;
  'rejected-envelope': null;
  'rejected-identity': null;
  'write-request': { key: string; value: Proposal };
  'write-ack': { key: string; value: Proposal };
  'write-unknown': { key: string; value: Proposal; error: string };
  sample: string;
  closing: null;
}
export type TraceEvent = {
  [K in keyof TraceDetails]: {
  sequence: number;
  at: number;
  elapsedMs: number;
  kind: K;
  detail: TraceDetails[K];
  state: NodeState;
  }
}[keyof TraceDetails];
type TraceArguments = {
  [K in keyof TraceDetails]: TraceDetails[K] extends null
    ? [kind: K, detail?: null] : [kind: K, detail: TraceDetails[K]]
}[keyof TraceDetails];

export interface AdapterOptions {
  peerId: string;
  roomEpoch: string;
  initialVoters: string[];
  send: (packet: WirePacket) => void;
  onTrace?: (event: TraceEvent) => void;
}

/** Native Hamok observation API. This is deliberately NOT an acceptance contract. */
export function createExperimentNode(options: AdapterOptions) {
  const initialVoters = [...options.initialVoters].sort();
  if (!options.roomEpoch || !initialVoters.includes(options.peerId)
    || new Set(initialVoters).size !== initialVoters.length) {
    throw new Error('Expected nonempty epoch and unique roster containing local peer');
  }
  const hamok = new Hamok({
    peerId: options.peerId,
    heartbeatInMs: TIMING.heartbeatInMs,
    electionTimeoutInMs: TIMING.electionTimeoutInMs,
    followerMaxIdleInMs: TIMING.followerMaxIdleInMs,
    logEntriesExpirationTimeInMs: TIMING.logEntriesExpirationTimeInMs,
  });
  const map = hamok.createMap<string, string>({
    mapId: 'experiment-decisions',
    requestTimeoutInMs: TIMING.requestTimeoutInMs,
  });
  const startedAt = Date.now();
  const trace: TraceEvent[] = [];
  let closed = false;

  function state(): NodeState {
    return {
      peerId: options.peerId,
      roomEpoch: options.roomEpoch,
      initialVoters: [...initialVoters],
      actualVoters: [options.peerId, ...hamok.remotePeerIds].sort(),
      term: hamok.raft.props.currentTerm,
      leader: hamok.raft.leaderId ?? null,
      role: hamok.raft.state.stateName,
      commitIndex: hamok.raft.logs.commitIndex,
      nextIndex: hamok.raft.logs.nextIndex,
      firstIndex: hamok.raft.logs.firstIndex,
      highestSeenMapCommitIndex: map.connection.highestSeenCommitIndex,
      entries: Object.fromEntries([...map.entries()].map(([key, value]) => [key, JSON.parse(value)])),
    };
  }

  function record(...[kind, detail = null]: TraceArguments) {
    const at = Date.now();
    // The argument tuple checks the relationship at every emission site.
    const event = { sequence: trace.length, at, elapsedMs: at - startedAt, kind, detail, state: state() } as TraceEvent;
    trace.push(event);
    options.onTrace?.(event);
  }

  hamok.on('error', error => record('error', String(error)));
  hamok.on('state-changed', (role, previous) => record('state-changed', { role, previous }));
  hamok.on('leader-changed', (leader, previous) => record('leader-changed', { leader, previous }));
  hamok.on('remote-peer-joined', peer => record('remote-peer-joined', peer));
  hamok.on('remote-peer-left', peer => record('remote-peer-left', peer));
  hamok.on('no-heartbeat-from', peer => record('no-heartbeat-from', peer));
  hamok.on('unsynced-peer', peer => record('unsynced-peer', peer));
  hamok.on('rejoining', () => record('rejoining'));
  hamok.on('commit', (index, message) => record('raft-commit', {
    index, requestId: message.requestId, storageId: message.storageId, type: message.type,
  }));
  map.on('insert', (key, value) => record('map-insert', { key, value: JSON.parse(value) }));
  map.on('update', (key, previous, value) => record('map-update', {
    key, previous: JSON.parse(previous), value: JSON.parse(value),
  }));
  // Map registered its synchronous request handler before these listeners.
  // Thus these observations are AFTER application, including buffered replay.
  map.connection.on('UpdateEntriesRequest', (request, index) => {
    const detail = {
      requestId: request.requestId,
      entries: Object.fromEntries([...request.entries].map(([key, value]) => [key, JSON.parse(value)])),
    };
    if (index === undefined) record('unindexed-map-request', { ...detail, index: null });
    else record('replicated-application', { ...detail, index });
  });
  map.connection.on('remote-snapshot', serialized => {
    record('snapshot-import', { serialized });
    queueMicrotask(() => { if (!closed) record('snapshot-position-observation'); });
  });
  hamok.on('message', message => {
    const packet: WirePacket = {
      protocolVersion: 1,
      roomEpoch: options.roomEpoch,
      source: options.peerId,
      destination: message.destinationId,
      bytes: Array.from(message.toBinary()),
    };
    options.send(packet);
  });
  initialVoters.forEach(peer => hamok.addRemotePeerId(peer));
  record('bootstrap', { hamokVersion: HAMOK_VERSION, timing: TIMING });

  return {
    state,
    trace: () => [...trace],
    async start() {
      await hamok.join({ fetchRemotePeerTimeoutInMs: 3_000, maxRetry: 1 });
      record('joined');
    },
    receive(packet: WirePacket) {
      if (closed) return false;
      if (packet.protocolVersion !== 1 || packet.roomEpoch !== options.roomEpoch
        || !initialVoters.includes(packet.source) || packet.source === options.peerId
        || (packet.destination !== undefined && packet.destination !== options.peerId)
        || packet.bytes.length > 1_048_576
        || packet.bytes.some(byte => !Number.isInteger(byte) || byte < 0 || byte > 255)) {
        record('rejected-envelope');
        return false;
      }
      try {
        const message = HamokMessage.fromBinary(Uint8Array.from(packet.bytes));
        if (message.sourceId !== packet.source || message.destinationId !== packet.destination) {
          record('rejected-identity');
          return false;
        }
        hamok.accept(message);
        return true;
      } catch (error) {
        record('receive-error', String(error));
        return false;
      }
    },
    async propose(value: Proposal, key = 'currentDecision', timeoutMs = 5_000) {
      const serialized = JSON.stringify(value);
      record('write-request', { key, value });
      const settled = map.set(key, serialized).then(() => {
        if (!closed) record('write-ack', { key, value });
        return { outcome: 'acknowledged' as const };
      }, error => {
        if (!closed) record('write-unknown', { key, value, error: String(error) });
        return { outcome: 'unknown' as const, error: String(error) };
      });
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<{ outcome: 'unknown'; error: string }>(resolve => {
        timer = setTimeout(() => {
          record('write-unknown', { key, value, error: 'adapter observation deadline' });
          resolve({ outcome: 'unknown', error: 'adapter observation deadline' });
        }, timeoutMs);
      });
      try { return await Promise.race([settled, deadline]); }
      finally { clearTimeout(timer); }
      // Timeout does not cancel native work; late application/ack remains traced.
    },
    sample(label: string) { record('sample', label); return state(); },
    close() {
      if (closed) return;
      record('closing');
      closed = true;
      hamok.close();
    },
  };
}

export type ExperimentNode = ReturnType<typeof createExperimentNode>;
