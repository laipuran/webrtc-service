import type { BrowserServer } from '@playwright/test';

export const BOUNDS = { scenario: 90_000, operation: 10_000, cleanup: 3_000 } as const;

export async function bounded<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label}: deadline ${ms}ms exceeded`)), Math.ceil(ms));
    })]);
  } finally { clearTimeout(timer); }
}

/** Retain launch ownership after a deadline: racing a promise does not cancel it. */
export async function launchBrowserServer(
  launch: (options: { timeout: number }) => Promise<BrowserServer>,
  ms = 15_000, cleanupMs: number = BOUNDS.cleanup,
) {
  let abandoned = false;
  const pending = launch({ timeout: ms }).then(async server => {
    if (abandoned) {
      try { await bounded(server.close(), cleanupMs, 'Late browser shutdown'); }
      catch (error) {
        console.error(error);
        try { await bounded(server.kill(), cleanupMs, 'Late browser kill'); }
        catch (error) { console.error(error); server.process().kill('SIGKILL'); }
      }
    }
    return server;
  });
  // The race retains rejection handlers on pending, including late launch/cleanup failures.
  try { return await bounded(pending, ms, 'Browser launch'); }
  catch (error) { abandoned = true; throw error; }
}

/** Stop starting work after the watchdog; individual operations share its budget. */
export function scenarioBounds(ms: number = BOUNDS.scenario) {
  const end = performance.now() + ms;
  let stopped = false;
  const waits = new Set<() => void>();
  return {
    stop() { stopped = true; for (const cancel of waits) cancel(); },
    wait(ms: number) {
      return new Promise<void>((resolve, reject) => {
        if (stopped) { reject(new Error('Observation after scenario stop')); return; }
        const cancel = () => { clearTimeout(timer); waits.delete(cancel); reject(new Error('Observation interrupted')); };
        const timer = setTimeout(() => { waits.delete(cancel); resolve(); }, ms);
        waits.add(cancel);
      });
    },
    async run<T>(label: string, work: () => Promise<T>, limit: number = BOUNDS.operation) {
      const remaining = end - performance.now();
      if (stopped || remaining <= 0) throw new Error(`${label}: scenario deadline/stop`);
      return bounded(work(), Math.min(limit, remaining), label);
    },
  };
}

/** Closing contexts is independent of page JS. Escalate to browser/process teardown. */
export async function cleanupBrowserScenario(
  contexts: { close(): Promise<void> }[], queues: Promise<void>[],
  closeBrowser: () => Promise<void>, killBrowser: () => void,
  ms: number = BOUNDS.cleanup,
) {
  const errors: string[] = [];
  const results = await Promise.allSettled([
    bounded(Promise.all(contexts.map(context => context.close())), ms, 'Context teardown'),
    bounded(Promise.all(queues), ms, 'Routing queue teardown'),
  ]);
  for (const result of results) if (result.status === 'rejected') errors.push(String(result.reason));
  if (errors.length) {
    try { await bounded(closeBrowser(), ms, 'Browser teardown'); }
    catch (error) { errors.push(String(error)); killBrowser(); }
  }
  return errors;
}
