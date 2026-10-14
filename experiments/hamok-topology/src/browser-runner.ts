import { chromium, type Page, type Browser, type BrowserContext } from '@playwright/test';
import { createServer } from 'vite';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { HAMOK_VERSION, TIMING, type TraceEvent, type WirePacket } from './adapter';
import { applications, assess, isObservedNoLeaderError, SCENARIOS } from './browser-evidence';
import { bounded, BOUNDS, scenarioBounds, cleanupBrowserScenario, launchBrowserServer } from './browser-bounds';

const seed = 20261014; // Records scenario selection, not native/browser scheduling randomness.
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until(check: () => boolean, ms: number, wait: (ms: number) => Promise<void>) {
  const end = performance.now() + ms;
  while (!check()) {
    if (performance.now() >= end) throw new Error(`Observation deadline ${ms}ms exceeded`);
    await wait(50);
  }
}

export async function scenario(browser: Browser, url: string, spec: typeof SCENARIOS[number], killBrowser: () => void,
  deadlineMs: number = BOUNDS.scenario) {
  const bounds = scenarioBounds(deadlineMs);
  const epoch = `browser-${seed}-${spec.name}`;
  const startedAt = Date.now();
  const start = performance.now();
  const now = () => performance.now() - start;
  const events: TraceEvent[] = [];
  const errors: string[] = [];
  const nativeErrors: TraceEvent[] = [];
  const consoleEvents: unknown[] = [];
  const transport: unknown[] = [];
  const schedule: unknown[] = [];
  const pages = new Map<string, Page>();
  const contexts: BrowserContext[] = [];
  const queues = new Map<string, Promise<void>>();
  let groups: string[][] = [[...spec.peers]];
  let closing = false;
  let initialized = false;
  let completed = false;
  let oldLeader: string | null = null;
  const snapshots: unknown[] = [];
  const proposals: unknown[] = [];
  const work = async () => {
    for (const peer of spec.peers) {
      const context = await bounds.run('Create context', () => browser.newContext().then(async context => {
        if (closing) {
          try { await bounded(context.close(), BOUNDS.cleanup, 'Late context teardown'); }
          catch { killBrowser(); }
          throw new Error('Late context after deadline');
        }
        return context;
      }));
      contexts.push(context);
      const page = await bounds.run('Create page', () => context.newPage());
      pages.set(peer, page);
      page.on('pageerror', error => errors.push(`${peer}: pageerror ${error.message}`));
      page.on('console', message => {
        consoleEvents.push({ peer, atMs: now(), type: message.type(), text: message.text() });
        if (message.type() === 'error') errors.push(`${peer}: console ${message.text()}`);
      });
      await bounds.run('Trace binding', () => page.exposeBinding('emitTrace', ({ page: source }, event: TraceEvent) => {
        if (closing) return;
        if (source !== page || event.state.peerId !== peer || event.state.roomEpoch !== epoch) {
          errors.push('Trace provenance mismatch'); return;
        }
        events.push(event);
        // A native no-leader submission error is an observed partition outcome,
        // not a broken harness. Preserve it; it still blocks the safety gate.
        if (isObservedNoLeaderError(event)) {
          nativeErrors.push(event);
        } else if (['error', 'receive-error', 'rejected-envelope', 'rejected-identity'].includes(event.kind)) {
          errors.push(`${peer}: adapter ${event.kind} ${JSON.stringify(event.detail)}`);
        }
      }));
      await bounds.run('Packet binding', () => page.exposeBinding('emitPacket', ({ page: source }, input: WirePacket) => {
        if (closing) return;
        // Never trust the envelope's source alone: bind it to the actual sending page.
        const packet: WirePacket = JSON.parse(JSON.stringify(input));
        if (source !== page || packet.source !== peer || packet.roomEpoch !== epoch
          || packet.protocolVersion !== 1 || !Array.isArray(packet.bytes)
          || packet.bytes.length > 1_048_576
          || packet.bytes.some(byte => !Number.isInteger(byte) || byte < 0 || byte > 255)
          || (packet.destination !== undefined && !spec.peers.some(p => p === packet.destination))) {
          errors.push(`Invalid transport provenance/envelope from ${peer}`); return;
        }
        const targets = packet.destination ? [packet.destination] : spec.peers.filter(p => p !== peer);
        for (const target of targets) {
          if (target === peer) { errors.push('Self-addressed packet'); continue; }
          const allowed = groups.some(group => group.includes(peer) && group.includes(target));
          const record = { id: transport.length, senderContext: peer, receiverContext: target,
            atMs: now(), packet, action: allowed ? 'queued' : 'dropped', deliveredAtMs: null as number | null };
          transport.push(record);
          if (!allowed) continue;
          const queue = (queues.get(target) ?? Promise.resolve()).then(async () => {
            while (!initialized && !closing) await sleep(10);
            if (closing) return;
            // Recheck at delivery: queued pre-partition packets cannot cross the new cut.
            if (!groups.some(group => group.includes(peer) && group.includes(target))) {
              record.action = 'dropped-at-delivery'; return;
            }
            const accepted = await bounds.run('Packet delivery', () => pages.get(target)!.evaluate(packet => window.experiment.node().receive(packet), packet));
            record.action = accepted ? 'delivered' : 'rejected';
            record.deliveredAtMs = now();
            if (!accepted) errors.push(`Receiver ${target} rejected ${record.id}`);
          }).catch(error => {
            // Context closure cancels in-flight traffic normally, but never hide a deadline.
            if (!closing || String(error).includes('deadline')) errors.push(`Routing: ${String(error)}`);
          });
          queues.set(target, queue);
        }
      }));
      await bounds.run('Page navigation', () => page.goto(url));
      await bounds.run('Page readiness', () => page.waitForFunction(() => !!window.experiment, undefined, { timeout: 10_000 }));
    }
    // All receivers exist before any native node sends bootstrap packets.
    await bounds.run('Initialization', () => Promise.all([...pages].map(([peer, page]) => page.evaluate(
      ({ peer, epoch, peers }) => window.experiment.init(peer, epoch, peers), { peer, epoch, peers: [...spec.peers] }))));
    initialized = true;
    await bounds.run('Native start', () => Promise.all([...pages.values()].map(page => page.evaluate(() => window.experiment.node().start()))), 15_000);
    schedule.push({ action: 'joined', atMs: now() });
    await bounds.run('Baseline proposal', () => pages.get('a')!.evaluate(() => window.experiment.node().propose({ revision: 0, digest: 'baseline' })), 8_000);
    await bounds.run('Baseline observation', () => until(() => spec.peers.every(peer => applications(events).some(item => item.peer === peer && item.value.revision === 0)), 10_000, bounds.wait));
    const before = await bounds.run('Before-fault sample', () => Promise.all([...pages.values()].map(page => page.evaluate(() => window.experiment.node().sample('before-fault')))));
    snapshots.push({ label: 'before-fault', atMs: now(), states: before });
    oldLeader = before.find(state => state.role === 'leader')?.peerId ?? null;
    if (!oldLeader) throw new Error('No observed pre-fault leader');
    if (spec.name !== 'stable-three') {
      groups = spec.name === 'old-leader-isolated'
        ? [[oldLeader], spec.peers.filter(peer => peer !== oldLeader)]
        : spec.groups!.map(group => [...group]);
      const faultAtMs = now();
      schedule.push({ action: 'partition', atMs: faultAtMs, groups: structuredClone(groups), oldLeader });
      await bounds.run('Partition observation', () => bounds.wait(33_000), 34_000);
      schedule.push({ action: 'partition-wait-complete', atMs: now(), durationMs: now() - faultAtMs });
    }
    const states = await bounds.run('Before-proposals sample', () => Promise.all([...pages.values()].map(page => page.evaluate(() => window.experiment.node().sample('before-proposals')))));
    snapshots.push({ label: 'before-proposals', atMs: now(), states });
    const requests = groups.map((group, index) => {
      const proposer = states.find(state => group.includes(state.peerId) && state.role === 'leader')?.peerId ?? group[0];
      const value = { revision: 1, digest: `side-${index}` };
      schedule.push({ action: 'propose', atMs: now(), proposer, value });
      return bounds.run('Partition proposal', () => pages.get(proposer)!.evaluate(value => window.experiment.node().propose(value), value), 8_000)
        .then(result => { proposals.push({ proposer, value, result, atMs: now() }); });
    });
    await Promise.all(requests);
    await bounds.run('Late application observation', () => bounds.wait(2_000));
    snapshots.push({ label: 'final', atMs: now(), states: await bounds.run('Final sample', () => Promise.all([...pages.values()].map(page => page.evaluate(() => window.experiment.node().sample('final'))))) });
    completed = true;
  };
  try { await bounded(work(), deadlineMs, 'Scenario watchdog'); }
  catch (error) { errors.push(String(error)); }
  finally {
    closing = true;
    bounds.stop();
    errors.push(...await cleanupBrowserScenario(contexts, [...queues.values()], () => browser.close(), killBrowser));
    if (errors.length) completed = false;
  }
  const assessment = assess(spec.name, groups, events);
  return { name: spec.name, epoch, initialVoters: [...spec.peers], seed, startedAt,
    durationMs: now(), contextCount: contexts.length, oldLeader, groups, schedule,
    completed, errors, nativeErrors, consoleEvents, proposals, snapshots, events, transport, assessment };
}

async function main() {
  const gate = process.argv.includes('--gate');
  const input = process.argv.find(arg => arg.startsWith('--input='))?.slice('--input='.length);
  try {
    let artifact;
    if (input) {
      if (!gate) throw new Error('--input is only supported for gate evaluation');
      artifact = JSON.parse(await readFile(input, 'utf8'));
    } else {
      const server = await createServer({ configFile: 'vite.page.config.ts', server: {
        host: '127.0.0.1', port: 0, watch: null, hmr: false,
      } });
      let browser: Browser | undefined;
      let browserServer: Awaited<ReturnType<typeof chromium.launchServer>> | undefined;
      const killBrowser = () => { browserServer?.process().kill('SIGKILL'); };
      try {
        await bounded(server.listen(), 10_000, 'Server listen');
        browserServer = await launchBrowserServer(options => chromium.launchServer(options));
        browser = await bounded(chromium.connect(browserServer.wsEndpoint()), 10_000, 'Browser connect');
        const chromiumVersion = browser.version();
        const results = [];
        for (const spec of SCENARIOS) {
          const result = await scenario(browser, server.resolvedUrls!.local[0], spec, killBrowser);
          results.push(result);
          console.log(`${result.name}: mechanics=${result.completed && !result.errors.length}, safety=${result.assessment.outcome}, indexed applications=${result.assessment.applications.length}`);
        }
        artifact = { schema: 1, hamok: HAMOK_VERSION, playwright: '1.64.0', chromium: chromiumVersion,
          node: process.version, seed, nativeElectionRandomness: 'unseeded', timing: TIMING, results };
        await mkdir('artifacts', { recursive: true });
        await writeFile('artifacts/browser-matrix.json', JSON.stringify(artifact, null, 2));
      } finally {
        try { await bounded(browserServer?.close() ?? Promise.resolve(), BOUNDS.cleanup, 'Browser shutdown'); }
        catch (error) { killBrowser(); console.error(error); process.exitCode = 1; }
        await bounded(server.close(), BOUNDS.cleanup, 'Server shutdown');
      }
    }
    if (artifact.schema !== 1 || artifact.hamok !== HAMOK_VERSION || artifact.results.length !== SCENARIOS.length) throw new Error('Invalid/incomplete matrix artifact');
    const mechanics = SCENARIOS.every(spec => {
      const result = artifact.results.find((item: { name: string }) => item.name === spec.name);
      return result?.completed && result.errors.length === 0 && result.contextCount === spec.peers.length
        && spec.peers.every(peer => applications(result.events).some(item => item.peer === peer && item.value.revision === 0))
        && (spec.name !== 'stable-three' || assess(result.name, result.groups, result.events).outcome === 'observed-stable')
        && (spec.name === 'stable-three' || result.schedule.some((item: { action: string; durationMs: number }) => item.action === 'partition-wait-complete' && item.durationMs > 32_000));
    });
    const safe = mechanics && artifact.results.every((result: { name: string; groups: string[][]; events: TraceEvent[] }) =>
      !result.events.some(event => ['error', 'receive-error'].includes(event.kind))
      && assess(result.name, result.groups, result.events).outcome === 'observed-stable');
    console.log(JSON.stringify({ mechanics, safetyGate: safe, artifact: input ?? 'artifacts/browser-matrix.json' }));
    if (!mechanics || (gate && !safe)) process.exitCode = 1;
  } catch (error) { console.error(error); process.exitCode = 1; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
