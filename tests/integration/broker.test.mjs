import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,chmod,rm,readdir,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {connect} from 'node:net';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
const require=createRequire(import.meta.url);
const {SpoolIngester,initializeSpool}=require('../../dist/transport.cjs');
await build({entryPoints:['src/transport/localBroker.ts'],bundle:true,platform:'node',format:'cjs',outfile:'.local/broker-integration.cjs'});
const {LocalBroker}=require('../../.local/broker-integration.cjs');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function setup(t){
 const path=await realpath(await mkdtemp(join(tmpdir(),'overwatch-broker-test-')));await chmod(path,0o700);t.after(()=>rm(path,{recursive:true,force:true}));
 const config=await initializeSpool(path,{collectorId:randomUUID(),environmentId:'local',workspaceId:'workspace'},path);
 const owner=await SpoolIngester.open(path,config);t.after(()=>owner.close());await owner.requireCollectorEpoch();return {path,owner,config:owner.publisherConfig(),inbox:join(path,'inbox',config.collectorId)};
}
async function enable(t,f){
 if(!await f.owner.startBroker()){t.skip('native Unix sockets unavailable in this sandbox');return false;}
 await f.owner.setPublisherEnabled(true);return true;
}
function invoke(f,epoch=f.config.collectorId){return new Promise((resolveResult,reject)=>{
 const child=spawn(resolve('dist/cursor-supervision-hook'),['beforeReadFile',f.path,epoch],{stdio:['pipe','pipe','pipe']});let stdout='',stderr='';
 const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('compiled-helper-timeout'));},3000);
 child.on('error',reject);child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);child.stdin.on('error',()=>{});
 child.on('close',code=>{clearTimeout(timer);resolveResult({code,stdout,stderr});});
 child.stdin.end(JSON.stringify({hook_event_name:'beforeReadFile',cursor_version:'3.26.16',workspace_roots:[f.path],conversation_id:'synthetic-broker',file_path:join(f.path,'read.txt'),prompt:'FAKE_SECRET_BROKER',exception:{message:'FAKE_SECRET_ERROR'}}));
});}
function allowed(result){assert.deepEqual(result,{code:0,stdout:'{"permission":"allow"}\n',stderr:''});}
function send(endpoint,event){return new Promise((resolveResult,reject)=>{const socket=connect(endpoint.path);let response='';const timer=setTimeout(()=>{socket.destroy();reject(new Error('broker-client-timeout'));},2000);socket.on('error',()=>{});socket.on('data',b=>response+=b);socket.on('close',()=>{clearTimeout(timer);resolveResult(response);});socket.on('connect',()=>socket.write(JSON.stringify({brokerVersion:1,token:endpoint.token,envelope:event})+'\n'));});}

test('B01/B06/B07/B09 real compiled helpers use durable broker, serialize spool retries and reject conflicting identities',async t=>{
 const f=await setup(t);if(!await enable(t,f))return;const endpoint=f.owner.publisherConfig().broker;
 for(const value of await Promise.all(Array.from({length:40},()=>invoke(f))))allowed(value);
 assert.equal(f.owner.journal.records.length,40);assert.deepEqual(await readdir(f.inbox),[]);const first=f.owner.journal.records[0].envelope;
 assert.equal(JSON.parse(await send(endpoint,first)).durable,true);assert.equal(f.owner.journal.records.length,40);
 await writeFile(join(f.inbox,first.eventId+'.json'),JSON.stringify(first),{mode:0o600});await f.owner.scan();assert.equal(f.owner.counters.duplicates,2);
 const conflict=structuredClone(first);conflict.result.counters.unknownFields++;
 assert.equal(await send(endpoint,conflict),'');assert.equal(f.owner.journal.records.length,40);
 for(const key of ['collectorId','environmentId','workspaceId','worktreeId'])assert.equal(await send(endpoint,{...first,[key]:'different'}),'');
 const wrongRoot=structuredClone(first);wrongRoot.result.metadata.workspaceRootHashes=['b'.repeat(64)];assert.equal(await send(endpoint,wrongRoot),'');assert.equal(f.owner.journal.records.length,40);
 assert.deepEqual(f.owner.journal.records.map(r=>r.ingestSequence),Array.from({length:40},(_,i)=>i+1));assert.equal(JSON.stringify(f.owner.journal.records).includes('FAKE_SECRET'),false);
 await f.owner.setPublisherEnabled(false);await assert.rejects(readFile(join(dirname(endpoint.path),'owner.json')),{code:'ENOENT'});assert.equal(f.owner.publisherConfig().broker,undefined);
});

test('B02/B09 missing endpoint falls back durably and stale collector never adopts the current generation',async t=>{
 const f=await setup(t);await f.owner.setPublisherEnabled(true);allowed(await invoke(f));assert.equal((await readdir(f.inbox)).length,1);await f.owner.scan();assert.equal(f.owner.journal.records.length,1);
 allowed(await invoke(f,randomUUID()));assert.deepEqual(await readdir(f.inbox),[]);assert.equal(f.owner.journal.records.length,1);
});

test('B08/B09 real helper times out after durable commit and fallback retains identical event bytes and identity',async t=>{
 const f=await setup(t);let committed,release;const pending=new Promise(resolve=>release=resolve);
 let broker;try{broker=await LocalBroker.open({guard:async()=>{},admit:()=>undefined,submit:async events=>{committed=events[0];const result=await f.owner.journal.appendBatch(events);await pending;return result;},rejected:()=>{}});}catch(error){if(['EPERM','EACCES'].includes(error.code??'')){t.skip('native Unix sockets unavailable in this sandbox');return;}throw error;}
 t.after(async()=>{release();await broker.close();});
 const current={...f.owner.publisherConfig(),enabled:true,broker:broker.endpoint};await writeFile(join(f.path,'publisher.json'),JSON.stringify(current),{mode:0o600});
 allowed(await invoke(f));assert.ok(committed);const names=await readdir(f.inbox);assert.deepEqual(names,[committed.eventId+'.json']);assert.equal(await readFile(join(f.inbox,names[0]),'utf8'),JSON.stringify(committed));assert.equal(f.owner.journal.records.length,1);
 release();await broker.close();await writeFile(join(f.path,'publisher.json'),JSON.stringify(f.owner.publisherConfig()),{mode:0o600});await f.owner.scan();assert.equal(f.owner.counters.duplicates,1);assert.equal(f.owner.journal.records.length,1);assert.deepEqual(await readdir(f.inbox),[]);
});

test('B10/B11/B13/B15 disabling closes old clients and endpoint; restart uses a fresh token and endpoint',async t=>{
 const f=await setup(t);if(!await enable(t,f))return;const old=f.owner.publisherConfig().broker;
 const socket=connect(old.path);socket.on('error',()=>{});await new Promise(resolve=>socket.on('connect',resolve));socket.write('{');await f.owner.setPublisherEnabled(false);assert.equal(f.owner.brokerStatus().state,'off');await assert.rejects(readFile(join(dirname(old.path),'owner.json')),{code:'ENOENT'});
 assert.equal(await f.owner.startBroker(),true);await f.owner.setPublisherEnabled(true);const current=f.owner.publisherConfig().broker;assert.notEqual(old.token,current.token);assert.notEqual(old.path,current.path);allowed(await invoke(f));assert.equal(f.owner.journal.records.length,1);
});

test('B08/B12 killed production broker recovers stale endpoint and deduplicates compiled helper fallback',async t=>{
 const path=await realpath(await mkdtemp(join(tmpdir(),'overwatch-broker-crash-')));await chmod(path,0o700);t.after(()=>rm(path,{recursive:true,force:true}));
 const config=await initializeSpool(path,{collectorId:randomUUID(),environmentId:'local',workspaceId:'workspace'},path);
 const script=`const {SpoolIngester}=require(process.argv[1]);setInterval(()=>{},1000);(async()=>{const owner=await SpoolIngester.open(process.argv[2],JSON.parse(process.argv[3]));await owner.requireCollectorEpoch();if(!await owner.startBroker()){process.send({type:'unavailable'});return;}await owner.setPublisherEnabled(true);const append=owner.journal.appendBatch.bind(owner.journal);owner.journal.appendBatch=async(...args)=>{const result=await append(...args);process.send({type:'durable'});await new Promise(()=>{});return result;};process.send({type:'ready',config:owner.publisherConfig()});})().catch(()=>process.send({type:'failed'}));`;
 const child=spawn(process.execPath,['-e',script,resolve('dist/transport.cjs'),path,JSON.stringify(config)],{stdio:['ignore','ignore','ignore','ipc']});
 t.after(()=>{if(child.exitCode===null)child.kill('SIGKILL');});
 function message(type){return new Promise((resolveResult,reject)=>{const timer=setTimeout(()=>{cleanup();reject(new Error('broker-child-timeout'));},5000);const cleanup=()=>{clearTimeout(timer);child.off('message',received);child.off('exit',exited);};const received=value=>{if(value.type===type||value.type==='unavailable'||value.type==='failed'){cleanup();resolveResult(value);}};const exited=()=>{cleanup();reject(new Error('broker-child-exited'));};child.on('message',received);child.on('exit',exited);});}
 const ready=await message('ready');assert.equal(ready.type,'ready','production broker startup must succeed with native permissions');
 const committed=message('durable'),publication=invoke({path,config:ready.config});await committed;
 const lease=JSON.parse(await readFile(join(path,'collector.lock'),'utf8'));const exited=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGKILL');await exited;allowed(await publication);
 const inbox=join(path,'inbox',config.collectorId);assert.equal((await readdir(inbox)).filter(n=>n.endsWith('.json')).length,1);
 const current=JSON.parse(await readFile(join(path,'publisher.json'),'utf8')),owner=await SpoolIngester.open(path,current,lease.token);t.after(()=>owner.close());
 assert.equal(owner.journal.records.length,1);await owner.setPublisherEnabled(false);assert.equal(owner.publisherConfig().broker,undefined);await assert.rejects(readFile(join(dirname(ready.config.broker.path),'owner.json')),{code:'ENOENT'});
 await owner.scan();assert.equal(owner.journal.records.length,1);assert.equal(owner.counters.duplicates,1);assert.deepEqual(await readdir(inbox),[]);
});

test('B10 current privacy is checked when a queued broker request reaches the journal writer',async t=>{
 const f=await setup(t);await f.owner.setPrivacyPolicy(f.path,[]);if(!await enable(t,f))return;
 let entered,release;const offered=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);
 const append=f.owner.journal.appendBatch.bind(f.owner.journal);f.owner.journal.appendBatch=async(...args)=>{entered();await gate;return append(...args);};
 const publication=invoke(f);await offered;
 // Immediate restrictive admission precedes asynchronous publisher/observer cleanup.
 f.owner.restrictPrivacy({privacyVersion:1,policyId:'0'.repeat(64),allowedPathHashes:[]});release();allowed(await publication);
 assert.equal(f.owner.journal.records.length,0);await f.owner.scan();assert.equal(f.owner.journal.records.length,0);assert.ok(f.owner.counters.policyRejected>0);assert.deepEqual(await readdir(f.inbox),[]);
});

test('B11 publisher substitution after durable sync withholds acknowledgment and preserves changed configuration',async t=>{
 const f=await setup(t);if(!await enable(t,f))return;
 let committed,release;const synced=new Promise(resolve=>committed=resolve),gate=new Promise(resolve=>release=resolve);
 const append=f.owner.journal.appendBatch.bind(f.owner.journal);f.owner.journal.appendBatch=async(...args)=>{const results=await append(...args);committed();await gate;return results;};
 const publication=invoke(f);await synced;
 const changed=JSON.stringify({...f.owner.publisherConfig(),enabled:false});await writeFile(join(f.path,'publisher.json'),changed,{mode:0o600});release();allowed(await publication);
 // The pre-change admission is durable, but its acknowledgment is withheld.
 // The helper's same-ID fallback proves it did not accept a success response.
 assert.equal(f.owner.journal.records.length,1);const event=f.owner.journal.records[0].envelope;
 assert.deepEqual(await readdir(f.inbox),[event.eventId+'.json']);assert.equal(await readFile(join(f.inbox,event.eventId+'.json'),'utf8'),JSON.stringify(event));
 await f.owner.close();assert.equal(await readFile(join(f.path,'publisher.json'),'utf8'),changed);
});
