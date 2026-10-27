import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,realpath,mkdir,rm,writeFile,readFile,open} from 'node:fs/promises';
import {tmpdir,cpus,platform,arch} from 'node:os';
import {join,resolve} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
const module=resolve(process.env.OVERWATCH_HISTORY_MANAGER_MODULE??'.local/t22-history-manager.cjs');if(!process.env.OVERWATCH_HISTORY_MANAGER_MODULE)await build({entryPoints:['src/integration/pluginManager.ts'],outfile:module,bundle:true,platform:'node',format:'cjs',target:'node22',logLevel:'silent'});
const require=createRequire(import.meta.url),{initializeSpool}=require('../dist/transport.cjs');
const root=await realpath(await mkdtemp(join(tmpdir(),'overwatch-history-cap-'))),storage=join(root,'.local','supervision-storage'),helper=resolve('dist/cursor-supervision-hook');let manager;
try{
 await writeFile(join(root,'.overwatch-probe-fixture'),'overwatch-invented-fixture-v1\n');await writeFile(join(root,'read.txt'),'Invented.\n');await mkdir(join(root,'.local'),{mode:0o700});await mkdir(storage,{mode:0o700});
 const workspaceId=createHash('sha256').update('workspace\0'+root).digest('hex'),config=await initializeSpool(storage,{collectorId:'measurement',environmentId:'local-darwin-arm64',workspaceId},root,true);
 await new Promise((resolveDone,reject)=>{const child=spawn(helper,['beforeReadFile',storage],{stdio:['pipe','ignore','ignore']});child.on('error',reject);child.on('close',code=>code===0?resolveDone():reject(new Error('seed-helper-failed')));child.stdin.end(JSON.stringify({hook_event_name:'beforeReadFile',cursor_version:'3.26.16',workspace_roots:[root],conversation_id:'synthetic',generation_id:'turn',tool_use_id:'call',file_path:join(root,'read.txt')}));});
 const names=await (await import('node:fs/promises')).readdir(join(storage,'inbox')),seed=JSON.parse(await readFile(join(storage,'inbox',names[0]),'utf8'));await rm(join(storage,'inbox',names[0]));
 const limit=100*1024*1024,segmentLimit=5*1024*1024;let total=0,count=0,segment=0,parts=[],partBytes=0;
 async function flush(){if(!parts.length)return;const file=await open(join(storage,'journal',`journal-${String(segment++).padStart(6,'0')}.ndjson`),'wx',0o600);try{await file.writeFile(parts.join(''));await file.sync();}finally{await file.close();}parts=[];partBytes=0;}
 while(count<100000){const envelope=structuredClone(seed),id=randomUUID();envelope.eventId=id;envelope.result.metadata.eventId=id;envelope.result.metadata.callId=createHash('sha256').update('call-'+count).digest('hex');const line=JSON.stringify({journalVersion:1,ingestSequence:count+1,envelope})+'\n',bytes=Buffer.byteLength(line);if(total+bytes>limit)break;if(partBytes+bytes>segmentLimit)await flush();parts.push(line);partBytes+=bytes;total+=bytes;count++;}await flush();
 const measured=await new Promise((resolveResult,reject)=>{const child=spawn(process.execPath,['--expose-gc',resolve('scripts/measure-history-reader.mjs'),module,root,storage,helper,String(count)],{stdio:['ignore','inherit','inherit','ipc']});let report;const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('history-reader-timeout'));},30000);child.on('message',value=>{report=value;});child.on('error',error=>{clearTimeout(timer);reject(error);});child.on('close',code=>{clearTimeout(timer);if(code!==0||!report)reject(new Error('history-reader-failed'));else resolveResult(report);});});
 const result={recordedAt:new Date().toISOString(),nativeDelivery:false,platform:platform(),arch:arch(),cpu:cpus()[0]?.model,node:process.version,records:count,bytes:total,segments:segment,...measured,budgetBytes:75*1024*1024,memoryBudgetPassed:measured.incrementalRssBytes<75*1024*1024,limitations:['Synthetic near-cap source journal is generated outside the measured reader process.','A fresh reader validates all retained records and completes the recent 5,000-record projection. Older payloads remain on disk.','RSS/heap are sampled reader-process measurements, not the installed shared extension host.','An explicit garbage collection precedes the reader baseline; no forced collection is used to reduce measured peaks.']};
 const output=process.env.OVERWATCH_HISTORY_OUTPUT??'t22-history-window-measurement.json';if(!/^t22-[a-z0-9-]+\.json$/.test(output))throw new Error('invalid-measurement-name');await writeFile(new URL('../docs/'+output,import.meta.url),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
}finally{await manager?.disable();await rm(root,{recursive:true,force:true});}
