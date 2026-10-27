import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {spawn, spawnSync} from 'node:child_process';
import {mkdtemp, realpath, open, chmod, readFile, writeFile, rm, mkdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {tmpdir, cpus, platform, arch} from 'node:os';

const root=await realpath(await mkdtemp(join(tmpdir(),'ow-batch-')));
const socketPath=join(root,'s'),journalPath=join(root,'journal.ndjson');
if(Buffer.byteLength(socketPath)>100)throw new Error('prototype-socket-path-too-long');
await chmod(root,0o700);
const client=resolve('.local/t22-batch-client');
const localGo=resolve('.local/go-toolchain/go/bin/go');
const built=spawnSync(existsSync(localGo)?localGo:'go',['build','-trimpath','-o',client,'scripts/fixtures/batch-client.go'],{stdio:'inherit',env:{...process.env,GOTOOLCHAIN:'local',GOCACHE:resolve('.local/go-cache')}});
if(built.status!==0)throw new Error('prototype-client-build-failed');
const journal=await open(journalPath,'wx',0o600);
const useJournalApi=process.argv.includes('--journal-api');
let owner,config;
if(useJournalApi){
 const require=createRequire(import.meta.url),{initializeSpool,SpoolIngester}=require('../dist/transport.cjs');
 const storage=join(root,'storage');await mkdir(storage,{mode:0o700});await writeFile(join(root,'read.txt'),'Invented batch fixture.\n');
 config=await initializeSpool(storage,{collectorId:randomUUID(),environmentId:'local',workspaceId:'synthetic'},root,true);owner=await SpoolIngester.open(storage,config);
}
const directory=await open(root,'r');await directory.sync();await directory.close();
const connections=new Set(),queue=[],batchSizes=[],ids=new Set();
let producer,flushTimer,flushing=false,accepted=0,flushes=0,maxQueued=0,failed=false;
const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
function schedule(){if(!flushing&&!flushTimer&&queue.length)flushTimer=setTimeout(()=>{flushTimer=undefined;void flush();},8);}
async function flush(){
 if(flushing||!queue.length)return;flushing=true;
 const batch=queue.splice(0,useJournalApi?32:64);
 try{
  const text=batch.map((item,index)=>JSON.stringify({prototypeVersion:1,sequence:accepted+index+1,eventId:item.id,padding:'synthetic-only-'.repeat(64)})).join('\n')+'\n';
  if(owner){
   const hash=value=>createHash('sha256').update(value).digest('hex');
   const envelopes=batch.map(item=>{const id=item.id.slice(0,8)+'-'+item.id.slice(8,12)+'-'+item.id.slice(12,16)+'-'+item.id.slice(16,20)+'-'+item.id.slice(20),receivedAt=new Date().toISOString();return{transportVersion:1,eventId:id,receivedAt,collectorId:config.collectorId,environmentId:config.environmentId,workspaceId:config.workspaceId,result:{metadata:{metadataVersion:1,eventId:id,receivedAt,sourceEvent:'beforeReadFile',sourceVersion:'3.26.16',tool:'read',workspaceRootHashes:[config.sourceRootHash],conversationId:hash('prototype-conversation'),generationId:hash('prototype-generation'),callId:hash(item.id),pathHash:hash('path-hint\0'+join(root,'read.txt')),policyId:config.policyId},counters:{unknownFields:0,sensitiveFields:0,invalidFields:0}}};});
   const results=await owner.journal.appendBatch(envelopes,envelope=>config.allowedPathHashes.includes(envelope.result.metadata.pathHash)&&envelope.result.metadata.policyId===config.policyId);
   if(results.some(result=>!result.added))throw new Error('prototype-admission-failed');
  }else{await journal.writeFile(text);await journal.sync();}
  accepted+=batch.length;flushes++;batchSizes.push(batch.length);
  for(const item of batch)item.socket.end('{"durable":true}\n');
 }catch{failed=true;for(const item of batch)item.socket.destroy();}
 finally{flushing=false;if(!failed)schedule();}
}
const server=createServer(socket=>{
 if(connections.size>=256||failed){socket.destroy();return;}
 connections.add(socket);let input='',received=false;
 socket.on('error',()=>{});socket.on('close',()=>connections.delete(socket));socket.setTimeout(2000,()=>socket.destroy());
 socket.on('data',bytes=>{
  if(received)return socket.destroy();
  input+=bytes.toString('utf8');if(Buffer.byteLength(input)>256)return socket.destroy();
  if(!input.includes('\n'))return;
  try{
   const value=JSON.parse(input.trim());
   if(!value||Object.keys(value).join(',')!=='eventId'||typeof value.eventId!=='string'||!/^[0-9a-f]{32}$/.test(value.eventId)||ids.has(value.eventId)||queue.length>=256)return socket.destroy();
   received=true;ids.add(value.eventId);queue.push({id:value.eventId,socket});maxQueued=Math.max(maxQueued,queue.length);schedule();
  }catch{socket.destroy();}
 });
});
try{
 await new Promise((done,reject)=>{server.once('error',reject);server.listen(socketPath,done);});await chmod(socketPath,0o600);
 producer=spawn(process.execPath,[resolve('scripts/emit-performance.mjs'),root,[client,'--connect',socketPath].map(quote).join(' '),randomUUID()],{stdio:['ignore','ignore','ignore','ipc']});
 const stage=await new Promise((done,reject)=>{
  const timer=setTimeout(()=>reject(new Error('prototype-producer-timeout')),30000);
  producer.on('error',error=>{clearTimeout(timer);reject(error);});
  producer.on('exit',()=>{clearTimeout(timer);reject(new Error('prototype-producer-exited'));});
  producer.on('message',message=>{if(message?.type==='complete'){clearTimeout(timer);done(message);}if(message?.type==='failed'){clearTimeout(timer);reject(new Error('prototype-producer-failed'));}});
  producer.send({stage:'burst'});
 });
 const bytes=await readFile(owner?join(root,'storage','journal','journal-000000.ndjson'):journalPath),records=bytes.toString('utf8').trim().split('\n').map(line=>JSON.parse(line));
 const result={recordedAt:new Date().toISOString(),prototype:true,journalApi:useJournalApi,productionIntegration:false,nativeDelivery:false,platform:platform(),arch:arch(),cpu:cpus()[0]?.model,node:process.version,stage,accepted,diskRecords:records.length,uniqueDiskRecords:new Set(records.map(row=>row.envelope?.eventId??row.eventId)).size,bytes:bytes.length,flushes,batchSizes,maxQueued,durability:'Each synthetic client acknowledgment follows journal write and sync.',complete:!failed&&stage.errors===0&&accepted===2000&&records.length===2000,limitations:['This is a disposable single-writer Unix-socket throughput prototype, not the extension transport.','The client ignores raw hook stdin and emits only a fresh random ID. The server constructs synthetic records; journal-api mode uses real source validation, lease checks, a static valid privacy admission policy and the production batch writer.','Endpoint authentication, dynamic privacy/ownership changes, fallback spool, epoch reset, interrupted broker recovery and packaging are not qualified by this prototype.','A production change would require integration and failure tests before qualification.']};
 await writeFile(resolve(useJournalApi?'docs/t22-batch-journal-api-prototype.json':'docs/t22-batch-transport-prototype.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({...result,batchSizes:undefined},null,2));
 assert.equal(result.complete,true);
}finally{
 producer?.kill('SIGTERM');if(flushTimer)clearTimeout(flushTimer);for(const socket of connections)socket.destroy();
 await new Promise(done=>server.close(()=>done()));while(flushing)await new Promise(done=>setTimeout(done,5));await owner?.setPublisherEnabled(false);await owner?.close();await journal.close();await rm(root,{recursive:true,force:true});
}
