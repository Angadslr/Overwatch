import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { CollectorHealth } from '../../src/core/health';
import type { EventV1 } from '../../src/core/contracts';

function event(source: EventV1['source'] = 'cursor-hook'): EventV1 {
  return { schemaVersion: 1, eventId: randomUUID(), collectorId: 'owner', environmentId: 'local', workspaceId: 'root',
    source, sourceEvent: source === 'self-check' ? 'transportGap' : 'beforeReadFile', receivedAt: '2026-10-24T12:00:00.000Z',
    operationId: randomUUID(), operation: 'unknown', phase: 'observed', outcome: 'unknown', actorScope: 'unknown', targets: [],
    evidence: { activity: source === 'self-check' ? 'self-check' : 'source-reported', attribution: 'unknown', completion: 'not-observed', diskPersistence: 'not-observed', correlation: 'unpaired', limitations: [] } };
}

test('publisher/collector readiness waits for a new source event and always discloses partial source coverage', () => {
  const health = new CollectorHealth(); assert.equal(health.snapshot().transport, 'disabled'); assert.equal(health.snapshot().publisherConfigured, false);
  health.beginCollection(); const ready = health.snapshot(); assert.equal(ready.transport, 'ready'); assert.equal(ready.publisherConfigured, true);
  assert.equal(ready.nativeDelivery, 'awaiting-first-event'); assert.ok(ready.status.includes('awaiting first native event')); assert.equal(ready.sourceCoverage, 'partial');
});

test('replayed source history and live diagnostic/self-check events never verify fresh native delivery', () => {
  const health = new CollectorHealth(); health.beginCollection(); health.observe(event(), 'replay'); health.observe(event('self-check'), 'live');
  const snapshot = health.snapshot(); assert.equal(snapshot.nativeDelivery, 'awaiting-first-event'); assert.equal(snapshot.historyEvents, 1);
  assert.equal(snapshot.sourceGapEvents, 1); assert.equal(snapshot.transport, 'ready'); assert.ok(snapshot.status.includes('History loaded'));
});

test('fresh source receipt changes delivery evidence, without proving comprehensive coverage or ongoing execution', () => {
  const health = new CollectorHealth(); health.beginCollection(); health.observe(event(), 'live');
  const snapshot = health.snapshot(); assert.equal(snapshot.nativeDelivery, 'source-event-observed'); assert.equal(snapshot.sourceCoverage, 'partial');
  assert.equal(snapshot.transport, 'ready'); assert.equal(snapshot.status.includes('running'), false);
  const older = event(); older.receivedAt = '2026-10-24T11:00:00.000Z'; health.observe(older, 'live');
  assert.equal(health.snapshot().lastNativeReceipt, snapshot.lastNativeReceipt);
});

test('transport degradation is independent of observed native delivery and source gaps', () => {
  const health = new CollectorHealth(); health.beginCollection(); health.syncTransport({ failures: 1, rejected: 0 });
  assert.equal(health.snapshot().transport, 'degraded'); assert.equal(health.snapshot().nativeDelivery, 'awaiting-first-event');
  health.observe(event(), 'live'); assert.equal(health.snapshot().transport, 'degraded'); assert.equal(health.snapshot().nativeDelivery, 'source-event-observed');
  health.syncTransport({ failures: 0, rejected: 0 }); assert.equal(health.snapshot().transport, 'degraded');
});

test('disable/re-enable resets current delivery evidence; old history cannot satisfy the new collection', () => {
  const health = new CollectorHealth(); health.beginCollection(); health.observe(event(), 'live'); health.disable();
  assert.equal(health.snapshot().transport, 'disabled'); assert.equal(health.snapshot().publisherConfigured, false);
  health.beginCollection(); health.observe(event(), 'replay'); assert.equal(health.snapshot().nativeDelivery, 'awaiting-first-event');
});

test('unsupported and explicit disconnection remain distinct from a quiet ready collector', () => {
  const health = new CollectorHealth(); health.unavailable(); health.observe(event(), 'live');
  assert.equal(health.snapshot().transport, 'unsupported'); assert.equal(health.snapshot().publisherConfigured, false);
  health.beginCollection(); assert.equal(health.snapshot().transport, 'ready'); health.disconnect();
  assert.equal(health.snapshot().transport, 'disconnected'); assert.ok(health.snapshot().status.includes('live state unknown'));
});

test('a producer loss marker degrades telemetry without inventing a native failure or a lost-event count',()=>{
 const health=new CollectorHealth();health.beginCollection();health.reportProducerLoss();const snapshot=health.snapshot();assert.equal(snapshot.transport,'degraded');assert.equal(snapshot.producerLoss,true);assert.equal(snapshot.sourceGapEvents,0);assert.equal(snapshot.nativeDelivery,'awaiting-first-event');assert.ok(snapshot.status.includes('producer reported telemetry loss'));health.beginCollection();assert.equal(health.snapshot().producerLoss,undefined);
});
