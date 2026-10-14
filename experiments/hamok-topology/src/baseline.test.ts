import { expect, it } from 'vitest';
import { runPartitionBaseline } from './baseline';

it('records the native 2+2 counterexample independently of safety success', async () => {
  const report = await runPartitionBaseline();
  expect(report.mechanismPassed).toBe(true);
  expect(report.safetyGatePassed).toBe(false);
  expect(report.partitioned.map(state => state.actualVoters)).toEqual([
    ['a', 'b'], ['a', 'b'], ['c', 'd'], ['c', 'd'],
  ]);
  expect(report.after.map(state => state.entries.currentDecision.digest)).toEqual([
    'left', 'left', 'right', 'right',
  ]);
});
