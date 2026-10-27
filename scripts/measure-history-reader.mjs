import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {performance} from 'node:perf_hooks';
import {writeHeapSnapshot, getHeapStatistics} from 'node:v8';
const [modulePath, root, storage, helper, expected] = process.argv.slice(2);
const require = createRequire(import.meta.url);
const {PluginManager} = require(modulePath);
const config = JSON.parse(await readFile(join(storage,'publisher.json'),'utf8'));
global.gc?.();
const initial = process.memoryUsage(), cpu = process.cpuUsage(), started = performance.now();
let manager, peakRss=initial.rss, peakHeap=initial.heapUsed, peakExternal=initial.external, peakBuffers=initial.arrayBuffers;
const statuses=[];
const sample=()=>{const memory=process.memoryUsage();peakRss=Math.max(peakRss,memory.rss);peakHeap=Math.max(peakHeap,memory.heapUsed);peakExternal=Math.max(peakExternal,memory.external);peakBuffers=Math.max(peakBuffers,memory.arrayBuffers);};
const timer=setInterval(sample,20);
try {
 manager=new PluginManager({root,storage,helper,collectorId:config.collectorId,eligibility:()=>undefined,changed:()=>{sample();if(manager?.status.startsWith('Loading retained history')&&!statuses.includes(manager.status))statuses.push(manager.status);}});
 await manager.enable();
 const openAndFirstProjectionMs=performance.now()-started;
 assert.equal(manager.readiness().history.retainedRecords,Number(expected));
 const deadline=Date.now()+15000;
 while(manager.evidence.size<Math.min(Number(expected),5000)&&Date.now()<deadline) await new Promise(resolve=>setTimeout(resolve,50));
 assert.equal(manager.evidence.size,Math.min(Number(expected),5000));
 sample();const settled=process.memoryUsage(),used=process.cpuUsage(cpu),completeRecentProjectionMs=performance.now()-started;
 if (process.env.OVERWATCH_PROFILE_HISTORY === '1') {
  writeHeapSnapshot(join(process.cwd(),'.local','t22-history.heapsnapshot'));
  console.log(JSON.stringify({profile:'history-live-heap',memory:process.memoryUsage(),heap:getHeapStatistics()}));
 }
 process.send?.({openAndFirstProjectionMs,completeRecentProjectionMs,sourceAndProjectionCpuMs:(used.user+used.system)/1000,incrementalRssBytes:peakRss-initial.rss,incrementalHeapBytes:peakHeap-initial.heapUsed,incrementalExternalBytes:peakExternal-initial.external,incrementalArrayBufferBytes:peakBuffers-initial.arrayBuffers,settledIncrementalRssBytes:settled.rss-initial.rss,peakObservedRssBytes:peakRss,bufferedRecords:manager.readiness().history.bufferedRecords,projectedEvidence:manager.evidence.size,stagedLoadingVisible:statuses.length>0,statuses:statuses.slice(0,3),history:manager.readiness().history});
} finally { clearInterval(timer);await manager?.disable(); }
