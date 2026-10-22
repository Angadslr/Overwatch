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
