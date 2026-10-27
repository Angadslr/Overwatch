import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,realpath,chmod,rm,readdir,readFile,writeFile,rename,symlink,stat,truncate } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';

const require=createRequire(import.meta.url);
const {initializeSpool,SpoolIngester}=require('../../dist/transport.cjs');
const {normalizeJournalRecord}=require('../../dist/cursor-projection.cjs');
const {FileActivityStore}=require('../../dist/file-activity.cjs');
const helper=resolve('dist/cursor-supervision-hook');
async function setup(t){
  const path=await realpath(await mkdtemp(join(tmpdir(),'overwatch-transport-')));await chmod(path,0o700);
  t.after(()=>rm(path,{recursive:true,force:true}));
  const config=await initializeSpool(path,{collectorId:'collector',environmentId:'local',workspaceId:'workspace'},path);
  return {path,config};
}
function invoke(path,hook='beforeReadFile',input){
  return new Promise((resolveResult,reject)=>{
    const child=spawn(helper,[hook,path],{stdio:['pipe','pipe','pipe']});let stdout='',stderr='';
    const timeout=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('helper-deadline'));},5000);
    child.stdout.on('data',b=>{stdout+=b;});child.stderr.on('data',b=>{stderr+=b;});
    child.on('error',reject);child.stdin.on('error',()=>{});
    child.on('close',code=>{clearTimeout(timeout);resolveResult({code,stdout,stderr});});
    child.stdin.end(input??JSON.stringify({hook_event_name:hook,cursor_version:'3.26.16',workspace_roots:[path],conversation_id:'fixture',generation_id:'turn',tool_use_id:'call',file_path:join(path,'read.txt'),prompt:'FAKE_SECRET_MARKER',tool_output:'FAKE_SECRET_MARKER',email:'fake@example.invalid'}));
  });
}
function response(result,permission=true){assert.deepEqual(result,{code:0,stdout:permission?'\u007b"permission":"allow"}\n':'{}\n',stderr:''});}

test('concurrent compiled publishers produce complete private records; committed retry is delivered once',async t=>{
  const {path,config}=await setup(t);
  for(const result of await Promise.all(Array.from({length:32},()=>invoke(path))))response(result);
  const files=await readdir(join(path,'inbox'));assert.equal(files.length,32);
  for(const name of files){assert.match(name,/^[0-9a-f-]{36}\.json$/);assert.equal((await stat(join(path,'inbox',name))).mode&0o777,0o600);const bytes=await readFile(join(path,'inbox',name),'utf8');assert.equal(bytes.includes('FAKE_SECRET_MARKER'),false);assert.equal(bytes.includes(path),false);JSON.parse(bytes);}
  const saved=await readFile(join(path,'inbox',files[0]));
  const owner=await SpoolIngester.open(path,config);
  try{assert.equal((await owner.scan()).length,32);assert.equal(owner.journal.records.length,32);
    await writeFile(join(path,'inbox',files[0]),saved,{mode:0o600});await owner.scan();await owner.scan();
    assert.equal(owner.journal.records.length,32);assert.equal(owner.counters.duplicates,1);assert.deepEqual(await readdir(join(path,'inbox')),[]);
  }finally{await owner.close();}
});

test('collector SIGKILL after sync before acknowledgment recovers without a second durable effect',async t=>{
  const {path,config}=await setup(t);response(await invoke(path));
  const module=resolve('dist/transport.cjs');
  const script=`const {SpoolIngester}=require(process.argv[1]);setInterval(()=>{},1000);(async()=>{const owner=await SpoolIngester.open(process.argv[2],JSON.parse(process.argv[3]));await owner.scan(async()=>{process.send('durable');await new Promise(()=>{});});})().catch(()=>process.exit(1));`;
  const child=spawn(process.execPath,['-e',script,module,path,JSON.stringify(config)],{stdio:['ignore','pipe','pipe','ipc']});
  t.after(()=>{if(child.exitCode===null)child.kill('SIGKILL');});
  const timeout=setTimeout(()=>child.kill('SIGKILL'),5000);
  const message=await Promise.race([once(child,'message'),once(child,'exit').then(()=>{throw new Error('collector-exited-before-commit');})]);
  clearTimeout(timeout);assert.equal(message[0],'durable');
  const lease=JSON.parse(await readFile(join(path,'collector.lock'),'utf8'));
  const exited=once(child,'exit');child.kill('SIGKILL');await exited;
  const owner=await SpoolIngester.open(path,config,lease.token);
  try{assert.equal(owner.journal.records.length,1);assert.equal((await owner.scan()).length,0);assert.equal(owner.counters.duplicates,1);assert.deepEqual(await readdir(join(path,'inbox')),[]);}finally{await owner.close();}
});

test('a durable batch survives collector SIGKILL before client acknowledgment and spool retries append no second effect',async t=>{
 const {path,config}=await setup(t);
 for(let i=0;i<8;i++)response(await invoke(path));
 const names=await readdir(join(path,'inbox')),events=await Promise.all(names.map(async name=>JSON.parse(await readFile(join(path,'inbox',name),'utf8'))));
 const script=`const {SpoolIngester}=require(process.argv[1]);setInterval(()=>{},1000);(async()=>{const owner=await SpoolIngester.open(process.argv[2],JSON.parse(process.argv[3]));await owner.journal.appendBatch(JSON.parse(process.argv[4]));process.send('batch-durable');await new Promise(()=>{});})().catch(()=>process.exit(1));`;
 const child=spawn(process.execPath,['-e',script,resolve('dist/transport.cjs'),path,JSON.stringify(config),JSON.stringify(events)],{stdio:['ignore','ignore','ignore','ipc']});
 t.after(()=>{if(child.exitCode===null)child.kill('SIGKILL');});
 const timeout=setTimeout(()=>child.kill('SIGKILL'),5000);
 const message=await Promise.race([once(child,'message'),once(child,'exit').then(()=>{throw new Error('batch-child-exited-before-sync');})]);clearTimeout(timeout);assert.equal(message[0],'batch-durable');
 const lease=JSON.parse(await readFile(join(path,'collector.lock'),'utf8')),exited=once(child,'exit');child.kill('SIGKILL');await exited;
 const owner=await SpoolIngester.open(path,config,lease.token);
 try{assert.equal(owner.journal.records.length,8);await owner.scan();assert.equal(owner.counters.duplicates,8);assert.equal(owner.journal.records.length,8);assert.equal(owner.journal.status().nextSequence,9);assert.deepEqual(await readdir(join(path,'inbox')),[]);}finally{await owner.close();}
});

test('permission, capacity, absent collector, disabled config and symlink failures preserve every hook response',async t=>{
  const {path}=await setup(t);
  const configPath=join(path,'publisher.json');const original=await readFile(configPath);
  const hooks=['sessionStart','preToolUse','postToolUse','postToolUseFailure','beforeReadFile','afterFileEdit','beforeShellExecution','afterShellExecution','beforeMCPExecution','afterMCPExecution','subagentStart','subagentStop','stop','sessionEnd'];
  const permissions=new Set(['preToolUse','beforeReadFile','beforeShellExecution','beforeMCPExecution','subagentStart']);
  await chmod(configPath,0o644);
  for(const hook of hooks)response(await invoke(path,hook),permissions.has(hook));
  assert.deepEqual(await readdir(join(path,'inbox')),[]);await chmod(configPath,0o600);
  const fill=join(path,'inbox','fill');await writeFile(fill,'',{mode:0o600});await truncate(fill,25*1024*1024);
  response(await invoke(path));assert.deepEqual(await readdir(join(path,'inbox')),['fill']);await rm(fill);
  await writeFile(configPath,JSON.stringify({...JSON.parse(original),enabled:false}),{mode:0o600});response(await invoke(path));
  await writeFile(configPath,original,{mode:0o600});response(await invoke(join(path,'absent')));
  await rename(join(path,'inbox'),join(path,'saved-inbox'));await symlink(join(path,'saved-inbox'),join(path,'inbox'));
  response(await invoke(path));assert.deepEqual(await readdir(join(path,'saved-inbox')),[]);
});

test('gap diagnostics survive malformed/oversized input without source outcomes or secret leakage',async t=>{
  const {path,config}=await setup(t);
  response(await invoke(path,'beforeReadFile','{FAKE_SECRET_MARKER'));
  response(await invoke(path,'beforeReadFile',Buffer.alloc(32*1024*1024+1,120)));
  const owner=await SpoolIngester.open(path,config);
  try{await owner.scan();assert.equal(owner.journal.records.length,2);const records=owner.journal.records;assert.equal(records.some(r=>r.envelope.result.metadata),false);assert.equal(JSON.stringify(records).includes('FAKE_SECRET_MARKER'),false);assert.deepEqual(new Set(records.map(r=>r.envelope.result.counters.gap)),new Set(['invalid-json','input-too-large']));}finally{await owner.close();}
});

test('compiled hook pipeline replays one read journey and a separate edit report without content or duplicate projection',async t=>{
  const {path,config}=await setup(t),file=join(path,'read.txt');
  const base={cursor_version:'3.26.16',workspace_roots:[path],conversation_id:'fixture-session',generation_id:'fixture-turn',tool_use_id:'fixture-call',tool_name:'Read'};
  for(const [hook,extra]of [
    ['preToolUse',{tool_input:{path:file,prompt:'FAKE_SECRET_MARKER'}}],
    ['beforeReadFile',{file_path:file}],
    ['postToolUse',{tool_input:{target_file:file},tool_output:'unknown output grammar: FAKE_SECRET_MARKER'}],
    ['afterFileEdit',{file_path:file,tool_name:'unknown'}],
  ]) response(await invoke(path,hook,JSON.stringify({...base,hook_event_name:hook,...extra})),hook==='preToolUse'||hook==='beforeReadFile');
  let owner=await SpoolIngester.open(path,config);await owner.scan();
  const first=new FileActivityStore();
  for(const record of owner.journal.records){const o=normalizeJournalRecord(record);assert.ok(o);first.apply(o);first.apply(o);}
  const snapshot=first.snapshot();assert.equal(snapshot.operations.length,2);assert.equal(snapshot.files.length,1);
  assert.equal(snapshot.files[0].attempts,1);assert.equal(snapshot.files[0].completedReads,1);assert.equal(snapshot.files[0].editReports,1);assert.equal(snapshot.files[0].diskPersistence,'unknown');assert.equal(snapshot.files[0].acceptance,'unknown');
  assert.equal(JSON.stringify(snapshot).includes('FAKE_SECRET_MARKER'),false);assert.equal(JSON.stringify(snapshot).includes(path),false);
  await owner.close();owner=await SpoolIngester.open(path,config);
  try{const replay=new FileActivityStore();for(const record of owner.journal.records)replay.apply(normalizeJournalRecord(record));assert.deepEqual(replay.snapshot(),snapshot);}finally{await owner.close();}
});

test('privacy filters excluded, mixed, symlink and exception paths before spool, journal and recovery', async t=>{
 const {path,config}=await setup(t);
 const owner=await SpoolIngester.open(path,config);
 try {
  await owner.setPrivacyPolicy(path,['edit.txt','FAKE_SECRET_EXCLUSION']);await owner.setPublisherEnabled(true);
  const current=JSON.parse(await readFile(join(path,'publisher.json'),'utf8'));
  const common={hook_event_name:'beforeReadFile',cursor_version:'3.26.16',workspace_roots:[path],conversation_id:'fixture-session',exception:{message:'FAKE_SECRET_EXCEPTION',stack:'FAKE_SECRET_STACK'},unknown:'FAKE_SECRET_UNKNOWN'};
  for(const target of ['.env.FAKE_SECRET_ENV','credentials.json','FAKE_SECRET_FILE.pem','edit.txt']) response(await invoke(path,'beforeReadFile',JSON.stringify({...common,file_path:join(path,target)})));
  response(await invoke(path,'beforeReadFile',JSON.stringify({...common,file_path:join(path,'read.txt'),tool_input:{path:join(path,'.env.FAKE_SECRET_MIXED')}})));
  await writeFile(join(path,'secret-target'),'FAKE_SECRET_CONTENT',{mode:0o600});await symlink(join(path,'secret-target'),join(path,'read.txt'));
  response(await invoke(path,'beforeReadFile',JSON.stringify({...common,file_path:join(path,'read.txt')})));
  await rm(join(path,'read.txt'));
  for(const name of await readdir(join(path,'inbox'))){const source=JSON.parse(await readFile(join(path,'inbox',name),'utf8'));assert.equal(source.result.metadata.pathHash,undefined);assert.ok(source.result.counters.privacy);}
  await owner.scan();assert.equal(owner.journal.records.length,6);
  assert.equal(owner.journal.records.filter(r=>r.envelope.result.counters.privacy==='path-unresolved').length,1);
  for(const changed of [{...current,privacyVersion:2},{...current,policyId:'a'.repeat(64)},{...current,privacyVersion:undefined,policyId:undefined,allowedPathHashes:undefined}]) {
   await writeFile(join(path,'publisher.json'),JSON.stringify(changed),{mode:0o600});
   response(await invoke(path,'beforeReadFile',JSON.stringify({...common,file_path:join(path,'read.txt')})));
  }
  await writeFile(join(path,'publisher.json'),JSON.stringify(current),{mode:0o600});
  await owner.scan();assert.equal(owner.journal.records.length,9);
  assert.equal(owner.journal.records.slice(-3).every(r=>r.envelope.result.counters.privacy==='policy-unavailable'&&!r.envelope.result.metadata.pathHash),true);
  response(await invoke(path,'beforeReadFile',JSON.stringify({...common,file_path:join(path,'read.txt')})));await owner.scan();
  assert.ok(owner.journal.records.at(-1).envelope.result.metadata.pathHash);
  for(const folder of ['inbox','journal'])for(const name of await readdir(join(path,folder))) {
   const bytes=await readFile(join(path,folder,name),'utf8'); assert.equal(bytes.includes('FAKE_SECRET'),false);assert.equal(bytes.includes(path),false);assert.equal(bytes.includes('edit.txt'),false);
  }
  const publisher=await readFile(join(path,'publisher.json'),'utf8');assert.equal(publisher.includes('FAKE_SECRET'),false);assert.equal(publisher.includes(path),false);
 } finally {await owner.close();}
 const current=JSON.parse(await readFile(join(path,'publisher.json'),'utf8'));const reopened=await SpoolIngester.open(path,current);
 try {assert.equal(reopened.journal.records.length,10);assert.equal(JSON.stringify(reopened.journal.records).includes('FAKE_SECRET'),false);}finally{await reopened.close();}
});

test('root routing refuses unrelated, nested and multi-root contexts even when a configured hook is invoked',async t=>{
 const {path,config}=await setup(t),nested=join(path,'nested');await (await import('node:fs/promises')).mkdir(nested);await writeFile(join(path,'read.txt'),'Invented.');
 const base={hook_event_name:'beforeReadFile',cursor_version:'3.26.16',conversation_id:'synthetic',file_path:join(path,'read.txt')};
 for(const roots of [[nested],[tmpdir()],[path,nested],[]])response(await invoke(path,'beforeReadFile',JSON.stringify({...base,workspace_roots:roots})));
 assert.deepEqual(await readdir(join(path,'inbox')),[]);
 response(await invoke(path,'beforeReadFile',JSON.stringify({...base,workspace_roots:[path]})));const owner=await SpoolIngester.open(path,config);
 try{await owner.scan();assert.equal(owner.journal.records.length,1);assert.equal(owner.journal.records[0].envelope.result.metadata.workspaceRootHashes.length,1);}finally{await owner.close();}
});

test('a full spool preserves the response and records one private content-free producer-loss marker',async t=>{
 const {path,config}=await setup(t),fill=join(path,'inbox','fill');await writeFile(fill,'',{mode:0o600});await truncate(fill,25*1024*1024);response(await invoke(path));
 const markerPath=join(path,'producer-loss.json'),first=await readFile(markerPath,'utf8'),marker=JSON.parse(first);assert.equal(marker.lossVersion,1);assert.equal(marker.category,'publication-failed');assert.ok(first.length<256);assert.equal(first.includes('FAKE_SECRET'),false);assert.equal(first.includes(path),false);assert.equal((await stat(markerPath)).mode&0o777,0o600);
 response(await invoke(path));assert.equal(await readFile(markerPath,'utf8'),first);await rm(fill);const owner=await SpoolIngester.open(path,config);try{assert.equal((await owner.inspectProducerFailure()).category,'publication-failed');assert.equal(owner.journal.records.length,0);}finally{await owner.close();}
});

test('explicit helper self-check has diagnostic identity and never becomes native Agent activity or a source gap',async t=>{
 const {path,config}=await setup(t);const checkId=(await import('node:crypto')).randomUUID();
 const result=await new Promise((resolveResult,reject)=>{const child=spawn(helper,['--self-check',path,checkId],{stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);child.on('error',reject);child.on('close',code=>resolveResult({code,stdout,stderr}));});
 response(result,false);const owner=await SpoolIngester.open(path,config);
 try{await owner.scan();assert.equal(owner.journal.records.length,1);const record=owner.journal.records[0];assert.equal(record.envelope.result.metadata,undefined);assert.equal(record.envelope.result.counters.checkId,checkId);
 const normalized=normalizeJournalRecord(record);assert.equal(normalized.event.source,'self-check');assert.equal(normalized.event.sourceEvent,'selfCheck');assert.equal(normalized.event.operation,'unknown');assert.equal(normalized.event.operationId,checkId);assert.deepEqual(normalized.event.targets,[]);assert.equal(normalized.pathHint,undefined);
 const sample=await owner.inspectQueue();assert.equal(sample.readyFiles,0);assert.equal(sample.incomplete,false);
 }finally{await owner.close();}
});

test('SIGKILL after retention manifest sync before unlink recovers monotonic sequence and retired retry deduplication',async t=>{
 const {path,config}=await setup(t),policy={segmentBytes:2048,historyBytes:4096,records:2,ageMs:86400000};
 response(await invoke(path));response(await invoke(path));const first=(await readdir(join(path,'inbox')))[0],saved=await readFile(join(path,'inbox',first));
 let owner=await SpoolIngester.open(path,config,undefined,{policy});await owner.scan();await owner.close();response(await invoke(path));
 const script=`const {SpoolIngester}=require(process.argv[1]);setInterval(()=>{},1000);(async()=>{const owner=await SpoolIngester.open(process.argv[2],JSON.parse(process.argv[3]),undefined,{policy:JSON.parse(process.argv[4]),afterRetentionCommit:async()=>{process.send('retention-committed');await new Promise(()=>{});}});await owner.scan();})().catch(()=>process.exit(1));`;
 const child=spawn(process.execPath,['-e',script,resolve('dist/transport.cjs'),path,JSON.stringify(config),JSON.stringify(policy)],{stdio:['ignore','ignore','ignore','ipc']});t.after(()=>{if(child.exitCode===null)child.kill('SIGKILL');});
 const timer=setTimeout(()=>child.kill('SIGKILL'),5000);
 const message=await Promise.race([once(child,'message'),once(child,'exit').then(()=>{throw new Error('retention-child-exited-before-commit');})]);clearTimeout(timer);assert.equal(message[0],'retention-committed');
 const lease=JSON.parse(await readFile(join(path,'collector.lock'),'utf8'));const exited=once(child,'exit');child.kill('SIGKILL');await exited;
 owner=await SpoolIngester.open(path,config,lease.token,{policy});try{await owner.scan();assert.equal(owner.journal.status().nextSequence,4);assert.equal(owner.journal.records.length,1);assert.equal(owner.journal.records[0].ingestSequence,3);
 await writeFile(join(path,'inbox',first),saved,{mode:0o600});await owner.scan();assert.equal(owner.counters.duplicates,1);assert.equal(owner.journal.records.length,1);assert.deepEqual(await readdir(join(path,'inbox')),[]);
 }finally{await owner.close();}
});
