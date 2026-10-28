import {readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';

const MIB = 1024 * 1024;
const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;

/** Resource qualification only. Native capability, privacy and recovery gates
 * still require their own evidence on the same implementation. */
export function qualifyResources(editor, history) {
  const gates = [];
  const below = (id, value, limit) => gates.push({id, value: finite(value) ? value : null, limit, passed: finite(value) && value < limit});
  const require = (id, passed) => gates.push({id, passed: passed === true});
  require('unprofiled-measurements', editor?.diagnosticTrace !== true && history?.diagnosticOnly !== true);
  require('qualified-platform', editor?.platform === 'darwin' && editor?.arch === 'arm64' && history?.platform === 'darwin' && history?.arch === 'arm64');
  require('normal-sample-count', editor?.normal?.attempts === 40 && editor?.normal?.samples === 40 && editor?.normal?.errors === 0);
  below('normal-helper-p95-ms', editor?.normal?.closedP95Ms, 50);
  below('provider-row-p95-ms', editor?.normal?.providerVisibleP95Ms, 1000);
  require('complete-burst', editor?.burst?.attempts === 2000 && editor?.burst?.errors === 0 && editor?.burst?.complete === true && editor?.burst?.totalObserved === 2041 && editor?.burst?.expectedTotal === 2041 && editor?.burst?.targetPerSecond === 200 && editor?.burst?.targetSeconds === 10);
  below('burst-helper-p95-ms', editor?.burst?.closedP95Ms, 50);
  require('idle-controls', [editor?.cpuUsage?.baselineSampleMs, editor?.cpuUsage?.emptySampleMs, editor?.cpuUsage?.idleSampleMs].every(value => finite(value) && value >= 15000) && finite(editor?.cpuUsage?.baselineOneCorePercent) && finite(editor?.cpuUsage?.emptyOneCorePercent));
  below('loaded-idle-cpu-percent', editor?.cpuUsage?.idleOneCorePercent, 1);
  below('installed-incremental-rss-bytes', editor?.memory?.incrementalRss, 75 * MIB);
  require('near-cap-history', Number.isSafeInteger(history?.records) && history.records > 5000 && finite(history?.bytes) && history.bytes >= 95 * MIB && history.bytes <= 100 * MIB && history?.history?.retainedRecords === history.records && history?.history?.bytes === history.bytes && history?.bufferedRecords === 5000 && history?.projectedEvidence === 5000);
  require('responsive-history-replay', finite(history?.completeRecentProjectionMs) && (history.completeRecentProjectionMs < 2000 || history?.stagedLoadingVisible === true));
  below('near-cap-incremental-rss-bytes', history?.incrementalRssBytes, 75 * MIB);
  return {passed: gates.every(gate => gate.passed), gates};
}

export function qualifyResourceSuite(editor, history, retiredHistory, warmHistory) {
  const primary = qualifyResources(editor, history);
  const historyChecks = new Set(['unprofiled-measurements', 'qualified-platform', 'near-cap-history', 'responsive-history-replay', 'near-cap-incremental-rss-bytes']);
  const gates = [...primary.gates];
  for (const [label, report] of [['retired-cap', retiredHistory], ['warm-reload', warmHistory]]) {
    for (const gate of qualifyResources(editor, report).gates.filter(gate => historyChecks.has(gate.id))) gates.push({...gate, id: label + ':' + gate.id});
    gates.push({id: label + ':full-retired-cap', passed: report?.retiredRecords === 100000 && report?.history?.retiredIdentities === 100000});
  }
  gates.push({id: 'warm-reload:observed-reload', passed: warmHistory?.warmReload === true && (warmHistory?.warmCache === true ? warmHistory?.checkpointState === 'loaded' : warmHistory?.checkpointState === 'cold-replay' && warmHistory?.stagedLoadingVisible === true)});
  return {passed: gates.every(gate => gate.passed), gates};
}

async function main() {
  const args = process.argv.slice(2), options = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    if (!['--editor', '--history', '--retired-history', '--warm-history', '--output'].includes(key) || !args[index + 1] || options[key]) throw new Error('Expected --editor REPORT --history REPORT --retired-history REPORT --warm-history REPORT --output RESULT');
    options[key] = args[index + 1];
  }
  if (Object.keys(options).length !== 5) throw new Error('Expected --editor REPORT --history REPORT --retired-history REPORT --warm-history REPORT --output RESULT');
  if ([options['--editor'], options['--history'], options['--retired-history'], options['--warm-history']].some(path => resolve(path) === resolve(options['--output']))) throw new Error('Qualification output must preserve input reports');
  const [editorBytes, historyBytes, retiredBytes, warmBytes] = await Promise.all(['--editor', '--history', '--retired-history', '--warm-history'].map(key => readFile(options[key])));
  const result = {recordedAt: new Date().toISOString(), scope: 'T22 resource suite: installed load, cold history, full retired capacity and warm reload', ...qualifyResourceSuite(JSON.parse(editorBytes), JSON.parse(historyBytes), JSON.parse(retiredBytes), JSON.parse(warmBytes)),
    inputs: {editorSha256: createHash('sha256').update(editorBytes).digest('hex'), historySha256: createHash('sha256').update(historyBytes).digest('hex'), retiredSha256: createHash('sha256').update(retiredBytes).digest('hex'), warmSha256: createHash('sha256').update(warmBytes).digest('hex')},
    limitations: ['Input hashes bind these measured reports, not the current source checkout. Verify implementation hashes separately.', 'Passing resource gates does not establish ordinary native delivery, failure containment, privacy, clean installation or user-pilot acceptance.']};
  await writeFile(options['--output'], JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({passed: result.passed, failed: result.gates.filter(gate => !gate.passed).map(gate => gate.id)}));
  process.exitCode = result.passed ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
