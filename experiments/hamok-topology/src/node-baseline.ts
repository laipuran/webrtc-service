import { mkdir, writeFile } from 'node:fs/promises';
import { runPartitionBaseline } from './baseline';

const report = await runPartitionBaseline();
await mkdir('artifacts', { recursive: true });
await writeFile('artifacts/node-baseline.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  mechanismPassed: report.mechanismPassed,
  safetyGatePassed: report.safetyGatePassed,
  partitioned: report.partitioned,
  after: report.after,
  artifact: 'artifacts/node-baseline.json',
}, null, 2));
// Mechanism success and strong-consistency safety are intentionally independent.
if (!report.mechanismPassed || (process.argv.includes('--gate') && !report.safetyGatePassed)) {
  process.exitCode = 1;
}
