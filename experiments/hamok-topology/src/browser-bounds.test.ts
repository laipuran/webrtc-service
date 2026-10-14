import { chromium } from '@playwright/test';
import { expect, it, vi } from 'vitest';
import { bounded, cleanupBrowserScenario, scenarioBounds } from './browser-bounds';
import { scenario } from './browser-runner';
import { SCENARIOS } from './browser-evidence';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises';

const never = () => new Promise<void>(() => {});

it('times out never-resolving page JS and closes its context without page JS cleanup', async () => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const started = performance.now();
    const bounds = scenarioBounds(1_000);
    await expect(bounds.run('Initialization', () => page.evaluate(() => new Promise<void>(() => {})), 50))
      .rejects.toThrow('Initialization: deadline');
    bounds.stop();
    const closeBrowser = vi.fn(() => browser.close());
    const errors = await cleanupBrowserScenario([context], [], closeBrowser, () => {}, 1_000);
    expect(errors).toEqual([]);
    expect(page.isClosed()).toBe(true);
    expect(browser.contexts()).toHaveLength(0);
    expect(closeBrowser).not.toHaveBeenCalled();
    expect(performance.now() - started).toBeLessThan(3_000);
  } finally { await browser.close(); }
});

it('records a stalled scenario as incomplete and makes the artifact gate exit nonzero', async () => {
  const browser = await chromium.launch();
  const directory = await mkdtemp('/tmp/opencode/topology-timeout-test-');
  const input = `${directory}/matrix.json`;
  try {
    const url = 'data:text/html,<script>window.experiment={init:()=>new Promise(()=>{})}</script>';
    const result = await scenario(browser, url, SCENARIOS[0], () => {}, 2_000);
    expect(result.completed).toBe(false);
    expect(result.errors.join(' ')).toContain('deadline');
    expect(result.assessment.outcome).toBe('unknown');
    expect(browser.contexts()).toHaveLength(0);
    await writeFile(input, JSON.stringify({ schema: 1, hamok: '2.6.0',
      results: SCENARIOS.map(spec => ({ ...result, name: spec.name })) }));
    await expect(promisify(execFile)(process.execPath,
      ['--import', 'tsx', 'src/browser-runner.ts', '--gate', `--input=${input}`], { timeout: 5_000 }))
      .rejects.toMatchObject({ code: 1, stdout: expect.stringContaining('"mechanics":false,"safetyGate":false') });
  } finally {
    await browser.close();
    await unlink(input).catch(() => {});
    await rmdir(directory);
  }
});

it('bounds stalled queues and context/browser teardown, then kills the browser process', async () => {
  const kill = vi.fn();
  const errors = await cleanupBrowserScenario([{ close: never }], [never()], never, kill, 20);
  expect(errors).toHaveLength(3);
  expect(errors.join(' ')).toContain('Routing queue teardown');
  expect(errors.join(' ')).toContain('Context teardown');
  expect(errors.join(' ')).toContain('Browser teardown');
  expect(kill).toHaveBeenCalledOnce();
});

it('enforces the total scenario budget even when an operation has a longer limit', async () => {
  const bounds = scenarioBounds(20);
  await expect(bounds.run('Sample', never, 1_000)).rejects.toThrow('deadline');
  bounds.stop();
  const work = vi.fn(never);
  await expect(bounds.run('After watchdog', work)).rejects.toThrow('scenario deadline/stop');
  expect(work).not.toHaveBeenCalled();
  bounds.stop();
});

it('interrupts observation timers on stop and bounds the whole scenario watchdog', async () => {
  const bounds = scenarioBounds();
  const observation = bounds.wait(33_000);
  const rejected = expect(observation).rejects.toThrow('interrupted');
  bounds.stop();
  await rejected;
  await expect(bounded(never(), 20, 'Scenario watchdog')).rejects.toThrow('Scenario watchdog');
});
