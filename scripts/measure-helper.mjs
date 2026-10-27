import {mkdtemp,realpath,rm,writeFile} from 'node:fs/promises';
import {tmpdir,cpus,platform,arch} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{initializeSpool}=require('../dist/transport.cjs');
if(platform()!=='darwin')throw new Error('measurement-requires-qualified-darwin-time');
const path=await realpath(await mkdtemp(join(tmpdir(),'overwatch-helper-measure-'))),helper=resolve('dist/cursor-supervision-hook');
const percentile=(values,p)=>[...values].sort((a,b)=>a-b)[Math.ceil(values.length*p)-1];
try{
 await writeFile(join(path,'read.txt'),'Invented performance fixture.\n');await initializeSpool(path,{collectorId:'measurement',environmentId:'local',workspaceId:'synthetic'},path);
 const input=JSON.stringify({hook_event_name:'beforeReadFile',cursor_version:'3.26.16',workspace_roots:[path],conversation_id:'synthetic',tool_use_id:'call',file_path:join(path,'read.txt')});
 const samples=[];
 for(let i=0;i<101;i++)samples.push(await new Promise((resolveResult,reject)=>{const start=performance.now(),child=spawn('/usr/bin/time',['-l',helper,'beforeReadFile',path],{stdio:['pipe','pipe','pipe']});let stdout='',measurement='',responseMs;const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('helper-measure-timeout'));},3000);child.stdout.on('data',b=>{stdout+=b;responseMs??=performance.now()-start;});child.stderr.on('data',b=>measurement+=b);child.stdin.on('error',()=>{});child.on('error',reject);child.on('close',code=>{clearTimeout(timer);if(code!==0||stdout!=='{"permission":"allow"}\n')return reject(new Error('helper-measure-failed'));const rss=/([0-9]+)\s+maximum resident set size/.exec(measurement),cpu=/([0-9.]+)\s+real\s+([0-9.]+)\s+user\s+([0-9.]+)\s+sys/.exec(measurement);if(!rss||!cpu)return reject(new Error('time-measurement-format'));resolveResult({responseMs,closedMs:performance.now()-start,maxRssBytes:Number(rss[1]),userSeconds:Number(cpu[2]),systemSeconds:Number(cpu[3])});});child.stdin.end(input);}));
 const warm=samples.slice(1),result={recordedAt:new Date().toISOString(),nativeDelivery:false,platform:platform(),arch:arch(),cpu:cpus()[0]?.model,node:process.version,firstLaunch:samples[0],warm:{samples:warm.length,responseP50Ms:percentile(warm.map(s=>s.responseMs),.5),responseP95Ms:percentile(warm.map(s=>s.responseMs),.95),closedP50Ms:percentile(warm.map(s=>s.closedMs),.5),closedP95Ms:percentile(warm.map(s=>s.closedMs),.95),maxRssBytes:Math.max(...warm.map(s=>s.maxRssBytes)),totalUserSeconds:warm.reduce((n,s)=>n+s.userSeconds,0),totalSystemSeconds:warm.reduce((n,s)=>n+s.systemSeconds,0)},limitations:['Each invocation starts a fresh helper process. Warm means repeated OS-cache/storage samples, not a persistent helper.','First launch is not a forced cold OS cache.','Response and close timings include /usr/bin/time and process startup; resource metrics are for the helper child. CPU is quantized by the OS time report.']};
 await writeFile(new URL('../docs/t22-helper-measurement.json',import.meta.url),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
}finally{await rm(path,{recursive:true,force:true});}
