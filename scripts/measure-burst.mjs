import assert from 'node:assert/strict';
import {mkdtemp,realpath,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{initializeSpool,SpoolIngester}=require('../dist/transport.cjs');
const root=await realpath(await mkdtemp(join(tmpdir(),'overwatch-burst-'))),helper=resolve('dist/cursor-supervision-hook'),delay=ms=>new Promise(r=>setTimeout(r,ms));let owner;
const percentile=(values,p)=>[...values].sort((a,b)=>a-b)[Math.ceil(values.length*p)-1];
try{
 await writeFile(join(root,'read.txt'),'Invented.\n');const config=await initializeSpool(root,{collectorId:'measurement',environmentId:'local',workspaceId:'synthetic'},root);owner=await SpoolIngester.open(root,config);owner.start();const close=[],response=[],jobs=[],errors=[],start=performance.now();
 for(let i=0;i<2000;i++){
  const wait=start+i*5-performance.now();if(wait>0)await delay(wait);
  jobs.push(new Promise((done,reject)=>{const launched=performance.now(),child=spawn(helper,['beforeReadFile',root],{stdio:['pipe','pipe','pipe']});let stdout='',stderr='',first=true;const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('burst-helper-timeout'));},3000);child.stdout.on('data',b=>{stdout+=b;if(first){first=false;response.push(performance.now()-launched);}});child.stderr.on('data',b=>stderr+=b);child.stdin.on('error',()=>{});child.on('error',reject);child.on('close',code=>{clearTimeout(timer);try{assert.deepEqual({code,stdout,stderr},{code:0,stdout:'{"permission":"allow"}\n',stderr:''});close.push(performance.now()-launched);done();}catch(error){reject(error);}});child.stdin.end(JSON.stringify({hook_event_name:'beforeReadFile',cursor_version:'3.26.16',workspace_roots:[root],conversation_id:'synthetic',generation_id:'turn',tool_use_id:'call-'+i,file_path:join(root,'read.txt')}));}).catch(error=>errors.push(error.message)));
 }
 await Promise.all(jobs);const deadline=Date.now()+15000;while(owner.journal.records.length<2000&&Date.now()<deadline){await owner.scan();await delay(100);}const result={recordedAt:new Date().toISOString(),nativeDelivery:false,ui:false,attempts:2000,accepted:owner.journal.records.length,elapsedMs:performance.now()-start,responseP95Ms:percentile(response,.95),closedP95Ms:percentile(close,.95),closedMaxMs:Math.max(...close),errors:errors.length,counters:owner.counters};await writeFile(new URL('../docs/t22-burst-isolation.json',import.meta.url),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
}finally{await owner?.close();await rm(root,{recursive:true,force:true});}
