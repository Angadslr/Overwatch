import assert from 'node:assert/strict';
import {mkdtemp, realpath, rm, writeFile, readdir, stat} from 'node:fs/promises';
import {tmpdir, cpus, platform, arch} from 'node:os';
import {join, resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const {initializeSpool, SpoolIngester} = require('../dist/transport.cjs');
const consumerEnabled = !process.argv.includes('--consumer-off');
const brokerRequested = process.argv.includes('--broker');
if(brokerRequested&&!consumerEnabled)throw new Error('broker-measurement-requires-live-consumer');
const outputOption = process.argv.find(value => value.startsWith('--output='));
const outputName = outputOption?.slice('--output='.length) ?? 't22-burst-generation.json';
if (!/^t22-[a-z0-9-]+\.json$/.test(outputName)) throw new Error('invalid-measurement-name');
const root = await realpath(await mkdtemp(join(tmpdir(), 'overwatch-burst-')));
const helper = resolve('dist/cursor-supervision-hook');
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let owner, producer;
try {
 await writeFile(join(root, 'read.txt'), 'Invented.\n');
 const config = await initializeSpool(root, {collectorId:randomUUID(), environmentId:'local', workspaceId:'synthetic'}, root, false);
 owner = await SpoolIngester.open(root, config);
 await owner.requireCollectorEpoch();
 if(brokerRequested&&!await owner.startBroker())throw new Error('native-broker-unavailable');
 await owner.setPublisherEnabled(true);
 if (consumerEnabled) owner.start();
 const command = [helper, 'beforeReadFile', root, config.collectorId].map(quote).join(' ');
 const before = process.memoryUsage(), cpu = process.cpuUsage(), start = performance.now();
 producer = spawn(process.execPath, [resolve('scripts/emit-performance.mjs'), root, command, randomUUID()], {stdio:['ignore','ignore','ignore','ipc']});
 const result = await new Promise((resolveResult, reject) => {
  const timeout = setTimeout(() => reject(new Error('burst-producer-timeout')), 45000);
  producer.on('error', error => { clearTimeout(timeout); reject(error); });
  producer.on('exit', () => { clearTimeout(timeout); reject(new Error('burst-producer-exited')); });
  producer.on('message', message => {
   if (message?.type === 'complete' && message.stage === 'burst') { clearTimeout(timeout); resolveResult(message); }
   if (message?.type === 'failed') { clearTimeout(timeout); reject(new Error('burst-producer-failed')); }
  });
  producer.send({stage:'burst'});
 });
 const publicationElapsedMs = performance.now() - start;
 const inbox = join(root, 'inbox', config.collectorId);
 const pendingAfterProducers = (await readdir(inbox)).filter(name => name.endsWith('.json') && name !== 'producer-loss.json').length;
 const deadline = Date.now() + 15000;
 while (owner.counters.accepted < result.attempts && Date.now() < deadline) {
  await owner.scan();
  if ((await owner.inspectQueue()).readyFiles === 0) break;
  await delay(25);
 }
 const used = process.cpuUsage(cpu), after = process.memoryUsage();
 const pending = await readdir(inbox);
 let inboxBytes = 0;
 for (const name of pending) inboxBytes += (await stat(join(inbox, name))).size;
 const report = {
  recordedAt:new Date().toISOString(), nativeDelivery:false, ui:false,
  platform:platform(), arch:arch(), cpu:cpus()[0]?.model, node:process.version,
  collectorGenerationRequired:true, consumerEnabledDuringPublication:consumerEnabled,
  transport:brokerRequested?'authenticated-broker-with-spool-fallback':'spool',
  producerGomaxprocs:process.env.GOMAXPROCS ?? 'default',
  producer:result, targetPerSecond:200, targetSeconds:10,
  accepted:owner.counters.accepted, complete:owner.counters.accepted === result.attempts,
  publicationElapsedMs, drainCompletedMs:performance.now()-start, pendingAfterProducers,
  pendingFiles:pending.length, inboxBytes, producerFailure:await owner.inspectProducerFailure(),
  counters:{...owner.counters},
  collectorCpuMs:(used.user+used.system)/1000,
  collectorIncrementalRssBytes:after.rss-before.rss,
  limitations:['Synthetic inputs from a separate producer process; this is not native Agent delivery.', 'Resource counters cover the collector process, excluding producer and helper children.', 'Consumer-off publishes first, then drains; it isolates producer behavior rather than measuring live view latency.'],
 };
 await writeFile(new URL('../docs/'+outputName, import.meta.url), JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report,null,2));
 assert.equal(result.errors,0);
} finally {
 producer?.kill('SIGTERM');
 if (owner) await owner.setPublisherEnabled(false);
 await owner?.close();
 await rm(root,{recursive:true,force:true});
}
