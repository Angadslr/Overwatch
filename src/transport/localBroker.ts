import {createServer, type Server, type Socket} from 'node:net';
import {randomBytes, randomUUID, createHash, timingSafeEqual} from 'node:crypto';
import {chmod, lstat, mkdtemp, readdir, realpath, rmdir, unlink} from 'node:fs/promises';
import {basename, dirname, isAbsolute, join} from 'node:path';
import {tmpdir} from 'node:os';
import {SecureDirectory, privateNode, sameFile} from './secureFs';
import {atomicPrivateJson, envelopeDigest, removePrivateFile} from './retention';
import {MAX_SOURCE_BYTES, parseSource, UUID_PATTERN} from './sourceValidation';
import type {SourceEnvelopeV1} from './sourceContracts';
import type {AppendResult} from './journal';

export interface BrokerEndpoint {brokerVersion:1; path:string; token:string; ownerId:string}
export type BrokerRejection = 'auth'|'schema'|'scope'|'policy'|'capacity'|'storage'|'closed';
export interface BrokerOptions {
 guard:()=>Promise<void>;
 admit:(event:SourceEnvelopeV1)=>BrokerRejection|undefined;
 submit:(events:readonly SourceEnvelopeV1[])=>Promise<AppendResult[]>;
 rejected:(reason:BrokerRejection)=>void;
}
export const BROKER_LIMITS = Object.freeze({connections:256,pending:256,bytes:4*1024*1024,frameBytes:MAX_SOURCE_BYTES+512,batch:32,delayMs:8,lifetimeMs:1000});
interface Pending {socket:Socket;event:SourceEnvelopeV1;digest:string;bytes:number}
interface Ownership {brokerVersion:1;ownerId:string;tokenDigest:string;socketDev:number;socketIno:number}
const tokenDigest=(token:string)=>createHash('sha256').update(token).digest('hex');

export function validBrokerEndpoint(value:unknown):value is BrokerEndpoint {
 const e=value as BrokerEndpoint;
 return Boolean(e && typeof e==='object' && Object.keys(e).sort().join(',')==='brokerVersion,ownerId,path,token' && e.brokerVersion===1 && typeof e.path==='string' && isAbsolute(e.path) && Buffer.byteLength(e.path)<=100 && basename(e.path)==='s' && /^overwatch-broker-[A-Za-z0-9]{6}$/.test(basename(dirname(e.path))) && typeof e.token==='string' && /^[0-9a-f]{64}$/.test(e.token) && typeof e.ownerId==='string' && UUID_PATTERN.test(e.ownerId));
}

/** Close a proven endpoint created by this process, or recover one under the
 * workspace lease after its owner died. Unknown entries are never rm-rf'd. */
export async function cleanupBrokerEndpoint(endpoint:BrokerEndpoint,guard:()=>Promise<void>):Promise<boolean> {
 if(!validBrokerEndpoint(endpoint))return false;
 let directory:SecureDirectory;
 try{directory=await SecureDirectory.open(dirname(endpoint.path));}catch(error){return(error as NodeJS.ErrnoException).code==='ENOENT';}
 try{
  const read=await directory.read('owner.json',2048),proof=JSON.parse(read.bytes.toString('utf8')) as Ownership;
  if(read.info.nlink!==1 || !proof || Object.keys(proof).sort().join(',')!=='brokerVersion,ownerId,socketDev,socketIno,tokenDigest' || proof.brokerVersion!==1 || proof.ownerId!==endpoint.ownerId || proof.tokenDigest!==tokenDigest(endpoint.token) || !Number.isSafeInteger(proof.socketDev) || !Number.isSafeInteger(proof.socketIno))return false;
  const ownsProof=async()=>{await guard();const current=await directory.read('owner.json',2048);if(current.info.nlink!==1||!sameFile(read.info,current.info)||!current.bytes.equals(read.bytes))throw new Error('broker-proof-changed');if((await readdir(directory.path)).some(name=>name!=='s'&&name!=='owner.json'))throw new Error('broker-directory-changed');};
  await ownsProof();await directory.guard();
  try{
   const info=await lstat(endpoint.path);
   if(!info.isSocket() || !privateNode(info) || info.dev!==proof.socketDev || info.ino!==proof.socketIno)return false;
   await ownsProof();await directory.guard();
   if(!sameFile(info,await lstat(endpoint.path)))return false;
   await unlink(endpoint.path);
  }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')return false;}
  await removePrivateFile(directory,'owner.json',ownsProof);await directory.sync();
  await guard();await directory.guard();
  try{await rmdir(directory.path);return true;}catch{return false;}
 }catch{return false;}finally{await directory.close();}
}

/** One authenticated frame per bounded local connection. A success response is
 * emitted only after the shared journal writer resolves its durable result. */
export class LocalBroker {
 readonly endpoint:BrokerEndpoint;
 private readonly server:Server;
 private readonly clients=new Set<Socket>();
 private readonly queue:Pending[]=[];
 private bufferedBytes=0;
 private timer:NodeJS.Timeout|undefined;
 private flushing:Promise<void>|undefined;
 private closed=false;
 private closeTask:Promise<void>|undefined;
 private constructor(endpoint:BrokerEndpoint,private readonly options:BrokerOptions){
  this.endpoint=endpoint;this.server=createServer(socket=>this.connection(socket));
  this.server.on('error',()=>{if(!this.closed)this.options.rejected('storage');});
 }
 static async open(options:BrokerOptions):Promise<LocalBroker>{
  await options.guard();
  const parent=await realpath(process.platform==='darwin'?'/private/tmp':tmpdir());
  const directory=await mkdtemp(join(parent,'overwatch-broker-'));
  const endpoint:BrokerEndpoint={brokerVersion:1,path:join(directory,'s'),token:randomBytes(32).toString('hex'),ownerId:randomUUID()};
  let broker:LocalBroker|undefined,proofWritten=false;
  try{
   await chmod(directory,0o700);if(!validBrokerEndpoint(endpoint))throw new Error('broker-path-unavailable');
   broker=new LocalBroker(endpoint,options);
   await new Promise<void>((resolve,reject)=>{const failed=(error:Error)=>{broker!.server.off('listening',ready);reject(error);};const ready=()=>{broker!.server.off('error',failed);resolve();};broker!.server.once('error',failed);broker!.server.once('listening',ready);broker!.server.listen(endpoint.path);});
   broker.server.unref();await chmod(endpoint.path,0o600);
   const info=await lstat(endpoint.path);if(!info.isSocket()||!privateNode(info))throw new Error('broker-path-unavailable');
   const owned=await SecureDirectory.open(directory);
   try{await atomicPrivateJson(owned,'owner.json',{brokerVersion:1,ownerId:endpoint.ownerId,tokenDigest:tokenDigest(endpoint.token),socketDev:info.dev,socketIno:info.ino},options.guard);}finally{await owned.close();}
   proofWritten=true;await options.guard();return broker;
  }catch(error){
   if(broker){broker.closed=true;await new Promise<void>(resolve=>broker!.server.close(()=>resolve()));}
   if(proofWritten)await cleanupBrokerEndpoint(endpoint,async()=>{});
   else await rmdir(directory).catch(()=>{});
   const failure=new Error('broker-unavailable') as NodeJS.ErrnoException;
   if(['EPERM','EACCES'].includes((error as NodeJS.ErrnoException).code??''))failure.code=(error as NodeJS.ErrnoException).code;
   throw failure;
  }
 }
 snapshot():{connections:number;queued:number;bufferedBytes:number;active:boolean}{return{connections:this.clients.size,queued:this.queue.length,bufferedBytes:this.bufferedBytes,active:!this.closed};}
 private reject(socket:Socket,reason:BrokerRejection):void{this.options.rejected(reason);socket.destroy();}
 private connection(socket:Socket):void{
  socket.on('error',()=>{});
  if(this.closed||this.clients.size>=BROKER_LIMITS.connections){this.reject(socket,this.closed?'closed':'capacity');return;}
  this.clients.add(socket);socket.unref();let bytes:Buffer=Buffer.alloc(0),queued=false;
  const deadline=setTimeout(()=>socket.destroy(),BROKER_LIMITS.lifetimeMs);deadline.unref();
  socket.on('close',()=>{clearTimeout(deadline);this.clients.delete(socket);if(!queued)this.bufferedBytes-=bytes.length;bytes=Buffer.alloc(0);});
  socket.on('end',()=>{if(!queued)socket.destroy();});
  socket.on('data',(chunk:Buffer)=>{
   if(queued){this.reject(socket,'schema');return;}
   if(bytes.length+chunk.length>BROKER_LIMITS.frameBytes||this.bufferedBytes+chunk.length>BROKER_LIMITS.bytes){this.reject(socket,'capacity');return;}
   this.bufferedBytes+=chunk.length;bytes=Buffer.concat([bytes,chunk]);
   const newline=bytes.indexOf(10);if(newline<0)return;
   if(newline!==bytes.length-1){this.reject(socket,'schema');return;}
   let frame:{brokerVersion?:unknown;token?:unknown;envelope?:unknown};
   try{frame=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,newline)));}catch{this.reject(socket,'schema');return;}
   if(!frame||typeof frame!=='object'||Object.keys(frame).sort().join(',')!=='brokerVersion,envelope,token'||frame.brokerVersion!==1){this.reject(socket,'schema');return;}
   if(typeof frame.token!=='string'||!/^[0-9a-f]{64}$/.test(frame.token)||!timingSafeEqual(Buffer.from(frame.token,'hex'),Buffer.from(this.endpoint.token,'hex'))){this.reject(socket,'auth');return;}
   const event=parseSource(Buffer.from(JSON.stringify(frame.envelope)));
   if(!event){this.reject(socket,'schema');return;}
   let refusal:BrokerRejection|undefined;
   try{refusal=this.options.admit(event);}catch{this.reject(socket,'storage');return;}
   if(refusal){this.reject(socket,refusal);return;}
   if(this.queue.length>=BROKER_LIMITS.pending){this.reject(socket,'capacity');return;}
   queued=true;this.queue.push({socket,event,digest:envelopeDigest(event),bytes:bytes.length});bytes=Buffer.alloc(0);this.schedule();
  });
 }
 private schedule():void{
  if(this.closed||this.timer||this.flushing||!this.queue.length)return;
  this.timer=setTimeout(()=>{this.timer=undefined;this.flushing=this.flush().finally(()=>{this.flushing=undefined;this.schedule();});},BROKER_LIMITS.delayMs);this.timer.unref();
 }
 private async flush():Promise<void>{
  const batch=this.queue.splice(0,BROKER_LIMITS.batch);
  try{
   await this.options.guard();
   const active=batch.filter(item=>!item.socket.destroyed&&!this.closed);
   const accepted:Pending[]=[];
   for(const item of active){const refusal=this.options.admit(item.event);if(refusal)this.reject(item.socket,refusal);else accepted.push(item);}
   if(!accepted.length)return;
   const results=await this.options.submit(accepted.map(item=>item.event));
   await this.options.guard();
   if(results.length!==accepted.length)throw new Error('broker-result-invalid');
   for(let index=0;index<accepted.length;index++){
    const item=accepted[index]!,result=results[index]!;
    if(this.closed||!result.record||result.expired){this.reject(item.socket,'closed');continue;}
    if(result.record.envelope.eventId!==item.event.eventId||envelopeDigest(result.record.envelope)!==item.digest)throw new Error('broker-result-invalid');
    item.socket.end(JSON.stringify({brokerVersion:1,eventId:item.event.eventId,digest:item.digest,durable:true})+'\n');
   }
  }catch(error){const reason=error instanceof Error&&error.message==='event-id-conflict'?'schema':'storage';for(const item of batch)if(!item.socket.destroyed)this.reject(item.socket,reason);}
  finally{for(const item of batch)this.bufferedBytes-=item.bytes;}
 }
 close():Promise<void>{
  if(this.closeTask)return this.closeTask;
  this.closed=true;if(this.timer)clearTimeout(this.timer);this.timer=undefined;
  for(const item of this.queue.splice(0)){this.bufferedBytes-=item.bytes;this.reject(item.socket,'closed');}
  for(const socket of this.clients)socket.destroy();
  this.closeTask=(async()=>{await new Promise<void>(resolve=>this.server.close(()=>resolve()));await this.flushing;if(!await cleanupBrokerEndpoint(this.endpoint,async()=>{}))throw new Error('broker-cleanup-unproven');})();
  return this.closeTask;
 }
}
