import {createHash,randomUUID} from 'node:crypto';
import {mkdir,opendir} from 'node:fs/promises';
import {join} from 'node:path';
import type {EventV1} from '../core/contracts';
import type {HealthSnapshot} from '../core/health';
import {readinessIssues,type ReadinessInput} from '../core/readiness';
import {parseEvent} from '../core/eventValidation';
import {permittedPath} from '../core/privacy';
import {PROBE_HOOKS} from '../integration/probe';
import {SecureDirectory} from '../transport/secureFs';
import {atomicPrivateBytes,removePrivateFile} from '../transport/retention';
export interface ExportInput{source:readonly EventV1[];local:readonly EventV1[];health:HealthSnapshot;readiness:ReadinessInput;exclusions:readonly string[];editorApiVersion:string}
export interface ExportPreview{token:string;text:string;sha256:string;bytes:number;expiresAt:string;relativePaths:boolean}
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
const identity=(namespace:string,value:string)=>digest('export-v1\0'+namespace+'\0'+value);
const events=new Set<string>([...PROBE_HOOKS,'fileChanged','bufferChanged','bufferSaved','transportGap','selfCheck']);
const count=(value:number|undefined)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:0;
export function buildLocalExport(input:ExportInput,relativePaths=false,now=Date.now()):object{
 const project=(supplied:readonly EventV1[],limit:number)=>{let invalid=0,excluded=0;const rows:object[]=[];
  for(const candidate of supplied.slice(-limit)){const checked=parseEvent(JSON.stringify(candidate),candidate.ingestSequence===undefined?'spool':'journal');if(!checked.ok){invalid++;continue;}const e=checked.event;
   if(e.targets.some(t=>t.relativePath&&!permittedPath(t.relativePath,input.exclusions)||t.renameDestination?.relativePath&&!permittedPath(t.renameDestination.relativePath,input.exclusions))){excluded++;continue;}
   rows.push({eventId:identity('event',e.eventId),collectorId:identity('collector',e.collectorId),environmentId:identity('environment',e.environmentId),workspaceId:identity('workspace',e.workspaceId),...(e.worktreeId?{worktreeId:identity('worktree',e.worktreeId)}:{}),
    ...(e.conversationId?{conversationId:identity('conversation',e.conversationId)}:{}),...(e.actorId?{actorId:identity('actor',e.actorId)}:{}),...(e.parentActorId?{parentActorId:identity('actor',e.parentActorId)}:{}),...(e.generationId?{generationId:identity('generation',e.generationId)}:{}),operationId:identity('operation',e.operationId),...(e.sourceCallId?{sourceCallId:identity('call',e.sourceCallId)}:{}),
    source:e.source,sourceEvent:events.has(e.sourceEvent)?e.sourceEvent:'unrecognized',receivedAt:e.receivedAt,...(e.sourceOccurredAt?{sourceOccurredAt:e.sourceOccurredAt}:{}),...(e.ingestSequence===undefined?{}:{ingestSequence:e.ingestSequence}),actorScope:e.actorScope,operation:e.operation,phase:e.phase,outcome:e.outcome,...(e.lifecycleScope?{lifecycleScope:e.lifecycleScope}:{}),evidence:e.evidence,...(e.metrics?{metrics:e.metrics}:{}),
    ...(relativePaths?{targets:e.targets.map(t=>({pathScope:t.pathScope,pathKind:t.pathKind,...(t.relativePath?{relativePath:t.relativePath}:{}),...(t.renameDestination?.relativePath?{renameDestination:{relativePath:t.renameDestination.relativePath}}:{})}))}:{targetCount:e.targets.length})});
  }return{provided:supplied.length,included:rows.length,outsideWindow:Math.max(0,supplied.length-limit),invalid,excluded,events:rows};
 };
 const health=input.health,c=input.readiness.counters;
 return{exportVersion:1,recordedAt:new Date(now).toISOString(),manifest:{destination:'local-only; no upload',relativePaths,identifiers:'pseudonymized consistently by field category',categories:['qualified runtime version','coarse collector/source health and issue codes','bounded normalized source evidence','bounded independent local observations','capacity, exclusion and validation counts'],omitted:['prompts, reasoning, content, tool input/output, transcripts, emails and exception text','absolute paths, file keys and native path hashes','hook configuration and original-hook backups','native conversation storage and user-defined aliases'],limits:{source:2000,local:500},notes:['This is a bounded snapshot, not a full journal archive.','Local observation actors remain unknown. Native file actors/physical overlap remain unqualified.','Optional relative paths come from normalized targets; hashed native source hints are not expanded.']},
  runtime:{editorApiVersion:/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(input.editorApiVersion)?input.editorApiVersion:'unqualified'},
  health:{transport:health.transport,publisherConfigured:health.publisherConfigured,nativeDelivery:health.nativeDelivery,sourceCoverage:health.sourceCoverage,sourceGapEvents:count(health.sourceGapEvents),historyEvents:count(health.historyEvents),producerLoss:Boolean(health.producerLoss),privacy:{excluded:count(health.privacy.excluded),policyUnavailable:count(health.privacy.policyUnavailable),unresolved:count(health.privacy.unresolved)}},
  readiness:{registered:input.readiness.registered,owner:input.readiness.owner,supported:input.readiness.supported,recoveredTail:input.readiness.recoveredTail,issueCodes:readinessIssues(input.readiness).map(i=>i.code),counters:{accepted:count(c.accepted),rejected:count(c.rejected),failures:count(c.failures),schemaRejected:count(c.schemaRejected),scopeRejected:count(c.scopeRejected),policyRejected:count(c.policyRejected)}},source:project(input.source,2000),local:project(input.local,500)};
}
/** A single immutable review is invalidated by privacy, retention or reset epoch changes. */
export class ReviewedExports{
 private active:{preview:ExportPreview;epoch:string}|undefined;
 private revision=0;
 constructor(private readonly storage:string){}
 prepare(input:ExportInput,epoch:string,relativePaths=false):ExportPreview{
  const text=JSON.stringify(buildLocalExport(input,relativePaths),null,2)+'\n',bytes=Buffer.byteLength(text);if(bytes>4*1024*1024)throw new Error('export-size-limit');
  const preview:ExportPreview={token:randomUUID(),text,sha256:digest(text),bytes,expiresAt:new Date(Date.now()+300000).toISOString(),relativePaths};this.revision++;this.active={preview,epoch};return{...preview};
 }
 invalidate():void{this.active=undefined;this.revision++;}
 currentToken():string|undefined{return this.active?.preview.token;}
 async save(token:string,epoch:()=>string,ownsLease:()=>Promise<void>):Promise<string>{
  const active=this.active;if(!active||token!==active.preview.token||active.epoch!==epoch()||Date.now()>=Date.parse(active.preview.expiresAt))throw new Error('export-review-stale');
  const revision=this.revision;this.active=undefined;await ownsLease();const root=await SecureDirectory.open(this.storage);
  try{await root.guard();await mkdir(join(this.storage,'exports'),{mode:0o700}).catch(error=>{if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;});await root.sync();}finally{await root.close();}
  const directory=await SecureDirectory.open(join(this.storage,'exports'));let files=0,total=0;
  try{const listing=await opendir(directory.path);try{while(true){const entry=await listing.read();if(!entry)break;if(++files>=20)throw new Error('export-capacity-limit');const file=await directory.file(entry.name);try{total+=file.info.size;}finally{await file.handle.close();}}}finally{await listing.close();}
   if(total+active.preview.bytes>20*1024*1024)throw new Error('export-capacity-limit');
   const name='export-'+randomUUID()+'.json';await atomicPrivateBytes(directory,name,Buffer.from(active.preview.text),async()=>{await ownsLease();if(revision!==this.revision||active.epoch!==epoch()||Date.now()>=Date.parse(active.preview.expiresAt))throw new Error('export-review-stale');});
   if(revision!==this.revision||active.epoch!==epoch()){await removePrivateFile(directory,name,ownsLease);await directory.sync();throw new Error('export-review-stale');}return join(directory.path,name);
  }finally{await directory.close();}
 }
}
