import {test} from 'node:test';
import assert from 'node:assert/strict';
import {qualifyResources, qualifyResourceSuite} from '../../scripts/qualify-resources.mjs';

function passing() {
  return {editor: {platform: 'darwin', arch: 'arm64', normal: {attempts: 40, samples: 40, errors: 0, closedP95Ms: 20, providerVisibleP95Ms: 200},
    burst: {attempts: 2000, errors: 0, complete: true, totalObserved: 2041, expectedTotal: 2041, targetPerSecond: 200, targetSeconds: 10, closedP95Ms: 30},
    cpuUsage: {baselineSampleMs: 15001, emptySampleMs: 15001, idleSampleMs: 15001, baselineOneCorePercent: 0.2, emptyOneCorePercent: 0.3, idleOneCorePercent: 0.4}, memory: {incrementalRss: 50 * 1024 * 1024}},
    history: {platform: 'darwin', arch: 'arm64', records: 97000, bytes: 100 * 1024 * 1024, history: {retainedRecords: 97000, bytes: 100 * 1024 * 1024}, bufferedRecords: 5000, projectedEvidence: 5000, completeRecentProjectionMs: 7000, stagedLoadingVisible: true, incrementalRssBytes: 60 * 1024 * 1024}};
}

test('resource qualification separates delivery success from CPU, installed memory, replay memory and burst latency', () => {
  const {editor, history} = passing();
  assert.equal(qualifyResources(editor, history).passed, true);
  editor.cpuUsage.idleOneCorePercent = 2;
  editor.memory.incrementalRss = 200 * 1024 * 1024;
  editor.burst.closedP95Ms = 55;
  history.incrementalRssBytes = 100 * 1024 * 1024;
  assert.deepEqual(qualifyResources(editor, history).gates.filter(gate => !gate.passed).map(gate => gate.id), ['burst-helper-p95-ms', 'loaded-idle-cpu-percent', 'installed-incremental-rss-bytes', 'near-cap-incremental-rss-bytes']);
});

test('resource qualification fails closed for absent, nonfinite, short-sample and incomplete measurements', () => {
  assert.equal(qualifyResources({}, {}).passed, false);
  for (const value of [undefined, null, '0', -1, NaN, Infinity, 50]) {
    const {editor, history} = passing();editor.normal.closedP95Ms = value;
    assert.equal(qualifyResources(editor, history).passed, false);
  }
  const cases = [pair => {pair.editor.diagnosticTrace = true;}, pair => {pair.history.diagnosticOnly = true;}, pair => {pair.editor.burst.totalObserved--;}, pair => {pair.editor.burst.errors++;}, pair => {pair.editor.cpuUsage.idleSampleMs = 1000;}, pair => {pair.history.projectedEvidence = 0;}, pair => {pair.history.history.bytes--;}, pair => {pair.history.stagedLoadingVisible = false;}, pair => {pair.history.incrementalRssBytes = 75 * 1024 * 1024;}];
  for (const change of cases) {const pair = passing();change(pair);assert.equal(qualifyResources(pair.editor, pair.history).passed, false);}
});

test('complete resource qualification requires full retired capacity and a measured warm reload including declared cache fallback', () => {
  const {editor, history} = passing();
  const retired = {...history, retiredRecords: 100000, history: {...history.history, retiredIdentities: 100000}};
  const warm = {...retired, warmReload: true, warmCache: false, checkpointState: 'cold-replay'};
  assert.equal(qualifyResourceSuite(editor, history, retired, warm).passed, true);
  assert.equal(qualifyResourceSuite(editor, history).passed, false);
  assert.equal(qualifyResourceSuite(editor, history, {...retired, retiredRecords: 0}, warm).passed, false);
  assert.equal(qualifyResourceSuite(editor, history, retired, {...warm, warmCache: true}).passed, false);
  assert.equal(qualifyResourceSuite(editor, history, retired, {...warm, warmCache: true, checkpointState: 'loaded'}).passed, true);
});
