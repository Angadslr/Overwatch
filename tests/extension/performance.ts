import * as vscode from 'vscode';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {Session} from 'node:inspector';
import {cpus,platform,arch} from 'node:os';
import type {SupervisionApi} from '../../src/commands';
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
const percentile=(values:number[],p:number):number=>[...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.ceil(values.length*p)-1)]!;
interface StageResult{stage:string;attempts:number;errors:number;responseP50Ms:number;responseP95Ms:number;closedP50Ms:number;closedP95Ms:number;closedMaxMs:number;elapsedMs:number}
export async function verifyPerformance(api:SupervisionApi,root:string):Promise<string[]>{
 assert.ok(api.manager&&api.tree);
 await api.disable();await delay(3000);
 const baselineCpu=process.cpuUsage(),baselineStart=performance.now();await delay(15000);const baseline=process.cpuUsage(baselineCpu),baselineWallMs=performance.now()-baselineStart;
 const baselineOneCorePercent=(baseline.user+baseline.system)/(baselineWallMs*10);
 assert.equal((await vscode.commands.executeCommand<{ok:boolean}>('overwatch.supervision.enable'))?.ok,true);
 const emptyCpu=process.cpuUsage(),emptyStart=performance.now();await delay(15000);const empty=process.cpuUsage(emptyCpu),emptyWallMs=performance.now()-emptyStart;
 const emptyOneCorePercent=(empty.user+empty.system)/(emptyWallMs*10);
 const extension=vscode.extensions.getExtension('angad-local.overwatch-native-probe')!;
 const command=JSON.parse(await readFile(join(root,'.cursor','hooks.json'),'utf8')).hooks.beforeReadFile.at(-1).command,nonce=randomUUID();
 const pending=new Map<string,bigint>(),visibleMs:number[]=[],stages=new Map<string,{resolve:(value:StageResult)=>void;reject:(error:Error)=>void}>();
 const child=spawn(process.env.OVERWATCH_TEST_NODE!,[join(extension.extensionPath,'scripts','emit-performance.mjs'),root,command,nonce],{stdio:['ignore','ignore','ignore','ipc']});
 child.on('error',()=>{for(const waiter of stages.values())waiter.reject(new Error('external-producer-unavailable'));});
 child.on('message',(message:any)=>{if(message?.type==='started'&&typeof message.call==='string'&&typeof message.startedNs==='string')pending.set(createHash('sha256').update('call\0'+message.call).digest('hex'),BigInt(message.startedNs));
  if(message?.type==='complete'){stages.get(message.stage)?.resolve(message);stages.delete(message.stage);}if(message?.type==='failed')stages.get(message.stage)?.reject(new Error('external-producer-failed'));});
 const probe=setInterval(()=>{if(!pending.size)return;const rows=api.tree!.getChildren().flatMap(n=>api.tree!.getChildren(n)),served=new Set(rows.map(n=>n.observation?.event.eventId));for(const observation of api.manager!.evidence.values()){const call=observation.event.sourceCallId;if(call&&pending.has(call)&&served.has(observation.event.eventId)){visibleMs.push(Number(process.hrtime.bigint()-pending.get(call)!)/1e6);pending.delete(call);}}},20);
 async function run(stage:string):Promise<StageResult>{return new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{stages.delete(stage);reject(new Error('performance-producer-timeout'));},30000);stages.set(stage,{resolve:value=>{clearTimeout(timeout);resolve(value);},reject:error=>{clearTimeout(timeout);reject(error);}});child.send({stage});});}
 async function settleViews(){const deadline=Date.now()+5000;while(pending.size&&Date.now()<deadline)await delay(20);assert.equal(pending.size,0);}
 const initial=process.memoryUsage(),cpu=process.cpuUsage(),wall=performance.now();let peakRss=initial.rss,peakHeap=initial.heapUsed;const sample=setInterval(()=>{const memory=process.memoryUsage();peakRss=Math.max(peakRss,memory.rss);peakHeap=Math.max(peakHeap,memory.heapUsed);},100);
 try{
  const first=await run('first');await settleViews();const firstProviderVisibleMs=visibleMs[0];const normal=await run('normal');await settleViews();
  const normalVisibility={samples:40,providerVisibleP50Ms:percentile(visibleMs.slice(1),.5),providerVisibleP95Ms:percentile(visibleMs.slice(1),.95)};
  const actors=new Set(Array.from({length:50},(_,i)=>createHash('sha256').update('conversation\0'+`t22-${nonce}-${i}`).digest('hex'))),burst=await run('burst'),deadline=Date.now()+15000;
  const observed=()=>[...api.manager!.evidence.values()].filter(o=>o.event.conversationId&&actors.has(o.event.conversationId)).length;
  while(observed()<2041&&Date.now()<deadline)await delay(100);
  const totalObserved=observed(),busyCpu=process.cpuUsage(cpu),busyWallMs=performance.now()-wall;
  await delay(3000);
  const transitionCpu=process.cpuUsage(),transitionStart=performance.now();await delay(3000);const transition=process.cpuUsage(transitionCpu),transitionWallMs=performance.now()-transitionStart;
  const latestReceipt=api.manager.health.snapshot().lastNativeReceipt;
  const settledWaitMs=latestReceipt?Math.max(0,Date.parse(latestReceipt)+31000-Date.now()):0;
  if(settledWaitMs)await delay(settledWaitMs);
  const profiler=process.env.OVERWATCH_PROFILE_CPU==='1'?new Session():undefined;
  const post=(method:string):Promise<any>=>new Promise((resolve,reject)=>profiler!.post(method as any,(error,result)=>error?reject(error):resolve(result)));
  if(profiler){profiler.connect();await post('Profiler.enable');await post('Profiler.start');}
  const idleCpu=process.cpuUsage(),idleStart=performance.now();await delay(15000);const idle=process.cpuUsage(idleCpu),idleWallMs=performance.now()-idleStart;
  if(profiler){try{const {profile}=await post('Profiler.stop');await writeFile(join(root,'..','idle.cpuprofile'),JSON.stringify(profile));}finally{profiler.disconnect();}}
  const result={recordedAt:new Date().toISOString(),nativeDelivery:false,platform:platform(),arch:arch(),cpu:cpus()[0]?.model,editorApiVersion:vscode.version,node:process.versions.node,firstLaunch:{...first,providerVisibleMs:firstProviderVisibleMs},normal:{...normal,...normalVisibility},burst:{...burst,targetPerSecond:200,targetSeconds:10,totalObserved,expectedTotal:2041,complete:totalObserved===2041},memory:{initialRss:initial.rss,peakRss,incrementalRss:peakRss-initial.rss,incrementalHeap:peakHeap-initial.heapUsed},cpuUsage:{baselineOneCorePercent,baselineSampleMs:baselineWallMs,emptyOneCorePercent,emptySampleMs:emptyWallMs,busyOneCorePercent:(busyCpu.user+busyCpu.system)/(busyWallMs*10),transitionOneCorePercent:(transition.user+transition.system)/(transitionWallMs*10),transitionSampleMs:transitionWallMs,settledWaitMs,idleOneCorePercent:(idle.user+idle.system)/(idleWallMs*10),idleIncrementalOneCorePercent:(idle.user+idle.system)/(idleWallMs*10)-baselineOneCorePercent,idleSampleMs:idleWallMs},readiness:api.manager.readiness(),limitations:['Synthetic inputs through the installed shell/helper path; no ordinary native Agent delivery claim.','Helper load runs in a separate Node process; only one coordinator child is hosted here.','First launch is not a forced cold OS cache.','Visibility means a matching TreeDataProvider row, not browser paint.','CPU/RSS cover the shared installed extension host and a bounded sampling probe; incremental values use this active-host baseline.','Transition CPU is measured separately while recent badges/uncertainty can age; settled idle begins at least 31 seconds after the last accepted source receipt.','Disabled/empty/loaded idle CPU are separate 15-second shared-host samples; their difference is an estimate, not exclusive process attribution.']};
  await writeFile(join(root,'..','performance.json'),JSON.stringify(result,null,2));assert.equal(totalObserved,2041);
  return ['external-process load measured first/warm response, provider visibility at 20 events/s, ten-second 200 events/s burst, and shared-host CPU/memory'];
 }finally{clearInterval(probe);clearInterval(sample);child.kill('SIGTERM');await api.disable();}
}
