import {test} from 'node:test';
import assert from 'node:assert/strict';
import {connect} from 'node:net';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile,rm,rename,symlink,lstat} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {LocalBroker,BROKER_LIMITS,cleanupBrokerEndpoint,type BrokerOptions} from '../../src/transport/localBroker';
import {envelopeDigest} from '../../src/transport/retention';
import type {SourceEnvelopeV1} from '../../src/transport/sourceContracts';
import type {AppendResult} from '../../src/transport/journal';
const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
function event():SourceEnvelopeV1{
 const eventId=randomUUID(),receivedAt=new Date().toISOString();
 return {transportVersion:1,eventId,receivedAt,collectorId:'collector',environmentId:'local',workspaceId:'workspace',result:{metadata:{metadataVersion:1,eventId,receivedAt,sourceEvent:'beforeReadFile',sourceVersion:'3.26.16',workspaceRootHashes:['a'.repeat(64)],tool:'read'},counters:{unknownFields:0,sensitiveFields:0,invalidFields:0}}};
}
function result(envelope:SourceEnvelopeV1,index=0):AppendResult{return {added:true,record:{journalVersion:1,ingestSequence:index+1,envelope}};}
async function open(t:{skip:(s:string)=>void;after:(fn:()=>Promise<void>)=>void},overrides:Partial<BrokerOptions>={}){
 const submitted:SourceEnvelopeV1[]=[],rejected:string[]=[];
 let broker:LocalBroker;
 try{broker=await LocalBroker.open({guard:async()=>{},admit:()=>undefined,submit:async events=>{submitted.push(...events);return events.map((e,i)=>result(e,i));},rejected:r=>rejected.push(r),...overrides});}
 catch(error){if(['EPERM','EACCES'].includes((error as NodeJS.ErrnoException).code??'')){t.skip('native Unix sockets unavailable in this sandbox');return;}throw error;}
 t.after(()=>broker.close());return{broker,submitted,rejected};
}
function send(broker:LocalBroker,payload:unknown,split=0):Promise<string>{
 const bytes=Buffer.isBuffer(payload)?payload:Buffer.from(JSON.stringify(payload)+'\n');
 return new Promise((resolve,reject)=>{const socket=connect(broker.endpoint.path);let response='';const timer=setTimeout(()=>{socket.destroy();reject(new Error('test-client-timeout'));},2000);
 socket.on('error',()=>{});socket.on('data',b=>response+=b);socket.on('close',()=>{clearTimeout(timer);resolve(response);});socket.on('connect',()=>{if(split){socket.write(bytes.subarray(0,split));setTimeout(()=>socket.write(bytes.subarray(split)),2);}else socket.write(bytes);});
 });
}
const frame=(broker:LocalBroker,envelope=event())=>({brokerVersion:1,token:broker.endpoint.token,envelope});

test('B01/B04 broker waits for durable submission and accepts split frames with exact acknowledgment',async t=>{
 let release!:()=>void,started!:()=>void;const pending=new Promise<void>(r=>release=r),entered=new Promise<void>(r=>started=r);
 const fixture=await open(t,{submit:async events=>{started();await pending;return events.map(e=>result(e));}});if(!fixture)return;
 const e=event();let settled=false;const response=send(fixture.broker,frame(fixture.broker,e),17).then(value=>{settled=true;return value;});
 await entered;await wait(20);assert.equal(settled,false);release();
 assert.deepEqual(JSON.parse(await response),{brokerVersion:1,eventId:e.eventId,digest:envelopeDigest(e),durable:true});
});

test('B02/B03 invalid authentication, schema, bytes and multiple frames never reach submission',async t=>{
 const f=await open(t);if(!f)return;const valid=frame(f.broker);
 for(const payload of [{...valid,token:'0'.repeat(64)},{...valid,token:undefined},{...valid,extra:'FAKE_SECRET'},{...valid,brokerVersion:2},{...valid,envelope:{...valid.envelope,eventId:randomUUID()}},Buffer.from([255,10]),Buffer.from('{\n'),Buffer.from(JSON.stringify(valid)+'\n{}\n'),Buffer.alloc(BROKER_LIMITS.frameBytes+1,120)])assert.equal(await send(f.broker,payload),'');
 assert.equal(f.submitted.length,0);assert.ok(f.rejected.includes('auth'));assert.ok(f.rejected.includes('schema'));assert.ok(f.rejected.includes('capacity'));
});

test('B04/B05 incomplete clients expire and release bounded buffers',async t=>{
 const f=await open(t);if(!f)return;assert.equal(await send(f.broker,Buffer.from('{"brokerVersion":1')),'');await wait(10);
 assert.deepEqual(f.broker.snapshot(),{connections:0,queued:0,bufferedBytes:0,active:true});assert.equal(f.submitted.length,0);
});

test('B06 concurrent frames use groups of at most 32 and return every exact event identity',async t=>{
 const groups:number[]=[];const f=await open(t,{submit:async events=>{groups.push(events.length);return events.map(e=>result(e));}});if(!f)return;
 const events=Array.from({length:80},()=>event());const responses=await Promise.all(events.map(e=>send(f.broker,frame(f.broker,e))));
 assert.deepEqual(responses.map(r=>JSON.parse(r).eventId),events.map(e=>e.eventId));assert.equal(groups.reduce((a,b)=>a+b,0),80);assert.ok(groups.every(n=>n<=32));
});

test('B10/B11 admission and ownership are rechecked after queuing and before acknowledgment',async t=>{
 let allowed=true,owned=true;const f=await open(t,{admit:()=>{if(!allowed)return 'policy';allowed=false;return undefined;},guard:async()=>{if(!owned)throw new Error('lost-owner');}});if(!f)return;
 assert.equal(await send(f.broker,frame(f.broker)),'');assert.equal(f.submitted.length,0);
 allowed=true;owned=false;assert.equal(await send(f.broker,frame(f.broker)),'');assert.equal(f.submitted.length,0);
});

test('B11 lost ownership after sync withholds a success acknowledgment',async t=>{
 let owned=true,submitted=0;const f=await open(t,{guard:async()=>{if(!owned)throw new Error('lost-owner');},submit:async events=>{submitted+=events.length;owned=false;return events.map(e=>result(e));}});if(!f)return;
 assert.equal(await send(f.broker,frame(f.broker)),'');assert.equal(submitted,1);assert.ok(f.rejected.includes('storage'));
});

test('B03 second frame arriving in a later packet is refused before submission',async t=>{
 const f=await open(t);if(!f)return;
 const socket=connect(f.broker.endpoint.path);socket.on('error',()=>{});await new Promise<void>(resolve=>socket.on('connect',resolve));
 const closed=new Promise<void>(resolve=>socket.on('close',resolve));socket.write(JSON.stringify(frame(f.broker))+'\n');await wait(2);socket.write('{}\n');await closed;
 assert.equal(f.submitted.length,0);assert.ok(f.rejected.includes('schema'));
});

test('B05 connection saturation stays within the published cap and releases clients',async t=>{
 const f=await open(t);if(!f)return;
 const sockets:ReturnType<typeof connect>[]=[];
 const add=()=>{const socket=connect(f.broker.endpoint.path);socket.on('error',()=>{});sockets.push(socket);};
 try{for(let offset=0;offset<BROKER_LIMITS.connections;offset+=32){for(let i=0;i<32;i++)add();await wait(10);}assert.equal(f.broker.snapshot().connections,BROKER_LIMITS.connections);for(let i=0;i<16;i++)add();await wait(30);assert.equal(f.broker.snapshot().connections,BROKER_LIMITS.connections);assert.ok(f.rejected.includes('capacity'));assert.equal(f.submitted.length,0);}
 finally{for(const socket of sockets)socket.destroy();}
 await wait(20);assert.equal(f.broker.snapshot().bufferedBytes,0);
});

test('B14 foreign entries preserve ownership proof and cleanup never follows a substituted endpoint',async t=>{
 const f=await open(t);if(!f)return;const parent=dirname(f.broker.endpoint.path),proof=await readFile(join(parent,'owner.json'));
 await writeFile(join(parent,'foreign.txt'),'FAKE_SECRET',{mode:0o600});assert.equal(await cleanupBrokerEndpoint(f.broker.endpoint,async()=>{}),false);
 assert.deepEqual(await readFile(join(parent,'owner.json')),proof);assert.equal(await readFile(join(parent,'foreign.txt'),'utf8'),'FAKE_SECRET');await rm(join(parent,'foreign.txt'));
 assert.equal(await cleanupBrokerEndpoint({...f.broker.endpoint,token:'0'.repeat(64)},async()=>{}),false);
 const saved=join(dirname(parent),'overwatch-saved-socket-'+randomUUID()),outside=join(dirname(parent),'overwatch-foreign-'+randomUUID());
 await writeFile(outside,'FAKE_SECRET_FOREIGN',{mode:0o600});await rename(f.broker.endpoint.path,saved);
 try{
  await symlink(outside,f.broker.endpoint.path);
  assert.equal(await cleanupBrokerEndpoint(f.broker.endpoint,async()=>{}),false);
  assert.equal((await lstat(f.broker.endpoint.path)).isSymbolicLink(),true);
  assert.equal(await readFile(outside,'utf8'),'FAKE_SECRET_FOREIGN');assert.deepEqual(await readFile(join(parent,'owner.json')),proof);
 }finally{await rm(f.broker.endpoint.path,{force:true});await rename(saved,f.broker.endpoint.path);await rm(outside);}
});

test('B15 closing during sync rejects acknowledgment, waits for write and removes the owned endpoint',async t=>{
 let release!:()=>void,started!:()=>void;const pending=new Promise<void>(r=>release=r),entered=new Promise<void>(r=>started=r);
 const f=await open(t,{submit:async events=>{started();await pending;return events.map(e=>result(e));}});if(!f)return;
 const response=send(f.broker,frame(f.broker));await entered;let finished=false;const closing=f.broker.close().then(()=>finished=true);
 await wait(20);assert.equal(finished,false);assert.equal(await response,'');release();await closing;await assert.rejects(readFile(join(dirname(f.broker.endpoint.path),'owner.json')), {code:'ENOENT'});
 assert.equal(f.broker.snapshot().bufferedBytes,0);
});

test('B14 proof substitution during cleanup preserves the changed proof and live socket',async t=>{
 const f=await open(t);if(!f)return;const file=join(dirname(f.broker.endpoint.path),'owner.json'),original=await readFile(file);
 const replacement=Buffer.from(JSON.stringify({...JSON.parse(original.toString('utf8')),ownerId:randomUUID()}));let changed=false;
 try{
  assert.equal(await cleanupBrokerEndpoint(f.broker.endpoint,async()=>{if(!changed){changed=true;await writeFile(file,replacement,{mode:0o600});}}),false);
  assert.deepEqual(await readFile(file),replacement);assert.equal((await lstat(f.broker.endpoint.path)).isSocket(),true);
 }finally{await writeFile(file,original,{mode:0o600});}
 const foreign=join(dirname(file),'late-foreign.txt');let guards=0;
 try{
  assert.equal(await cleanupBrokerEndpoint(f.broker.endpoint,async()=>{if(++guards===2)await writeFile(foreign,'FAKE_SECRET_LATE',{mode:0o600});}),false);
  assert.deepEqual(await readFile(file),original);assert.equal((await lstat(f.broker.endpoint.path)).isSocket(),true);assert.equal(await readFile(foreign,'utf8'),'FAKE_SECRET_LATE');
 }finally{await rm(foreign,{force:true});}
});
