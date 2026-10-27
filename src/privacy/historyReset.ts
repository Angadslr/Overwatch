import {createHash,randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {opendir,rmdir} from 'node:fs/promises';
import {SecureDirectory} from '../transport/secureFs';
import {SpoolIngester,initializeSpool} from '../transport/spoolIngester';
import {atomicPrivateJson,removePrivateFile} from '../transport/retention';
import {OPAQUE_PATTERN,UUID_PATTERN} from '../transport/sourceValidation';
import {inspectWorkspaceLease} from '../integration/workspaceLease';
import {assertFixtureRoot} from '../integration/probe';
interface ResetIntent{resetVersion:1;workspaceId:string;oldEpoch:string;newEpoch:string;includeExports:boolean}
interface SelectedFile{parent:string;name:string;bytes:number}
export interface ResetReview{token:string;expiresAt:string;workspaceId:string;includeExports:boolean;interrupted:boolean;files:number;bytes:number;preservedUnknownEntries:number;categories:string[];notes:string[]}
const ready=/^[0-9a-f-]{36}\.json$/,temporary=/^[0-9a-f-]{36}\.[0-9a-f-]{36}\.tmp$/;
const rootArtifact=/^(?:projection-checkpoint\.json|view-report\.json|producer-loss\.json|(?:history|report)-[0-9a-f-]{36}\.tmp)$/;
const journalArtifact=/^(?:journal-\d{6}\.ndjson|retention\.json|history-[0-9a-f-]{36}\.tmp)$/;
const exportArtifact=/^export-[0-9a-f-]{36}\.(json|tmp)$/;
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
function parseIntent(value:unknown,workspaceId:string,epoch:string):ResetIntent{
 const i=value as ResetIntent;if(!i||Object.keys(i).sort().join(',')!=='includeExports,newEpoch,oldEpoch,resetVersion,workspaceId'||i.resetVersion!==1||i.workspaceId!==workspaceId||typeof i.oldEpoch!=='string'||!OPAQUE_PATTERN.test(i.oldEpoch)||typeof i.newEpoch!=='string'||!UUID_PATTERN.test(i.newEpoch)||typeof i.includeExports!=='boolean'||![i.oldEpoch,i.newEpoch].includes(epoch))throw new Error('reset-intent-invalid');return i;
}
/** Review owns an exclusive disabled pipeline. Cancellation releases it without deleting history. */
export class HistoryReset{
 private active:{review:ResetReview;intent:ResetIntent;owner:SpoolIngester;timer:NodeJS.Timeout}|undefined;
 constructor(private readonly root:string,private readonly storage:string){}
 private async validateScope():Promise<void>{if(this.storage!==join(this.root,'.local','supervision-storage'))throw new Error('invalid-reset-scope');try{await assertFixtureRoot(this.root);}catch{throw new Error('invalid-reset-scope');}}
 private async selection(intent:ResetIntent):Promise<{files:SelectedFile[];unknown:number}>{
  const files:SelectedFile[]=[];let unknown=0;
  const scan=async(parent:string,accept:(name:string)=>boolean,limit:number,ignore?:(name:string)=>boolean)=>{
   let directory:SecureDirectory;try{directory=await SecureDirectory.open(parent);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error;}
   let listing:Awaited<ReturnType<typeof opendir>>|undefined;let count=0;try{listing=await opendir(parent);while(true){const entry=await listing.read();if(!entry)break;if(++count>limit)throw new Error('reset-directory-limit');if(ignore?.(entry.name))continue;if(!accept(entry.name)){unknown++;continue;}
    const file=await directory.file(entry.name);try{if(file.info.nlink!==1)throw new Error('reset-unsafe-file');files.push({parent,name:entry.name,bytes:file.info.size});}finally{await file.handle.close();}
   }}finally{await listing?.close();await directory.close();}
  };
  await scan(this.storage,name=>rootArtifact.test(name),128,name=>['publisher.json','collector.lock','hook-ownership.json','reset-intent.json','journal','inbox','exports'].includes(name));
  await scan(join(this.storage,'journal'),name=>journalArtifact.test(name),64);
  await scan(join(this.storage,'inbox'),name=>ready.test(name)||temporary.test(name)||name==='producer-loss.json',10064,name=>name===intent.oldEpoch||name===intent.newEpoch);
  for(const epoch of new Set([intent.oldEpoch,intent.newEpoch]))await scan(join(this.storage,'inbox',epoch),name=>ready.test(name)||temporary.test(name)||name==='producer-loss.json',10064);
  await scan(join(this.storage,'exports'),name=>/^history-[0-9a-f-]{36}\.tmp$/.test(name)||(exportArtifact.test(name)&&(intent.includeExports||name.endsWith('.tmp'))),64,name=>!intent.includeExports&&/^export-[0-9a-f-]{36}\.json$/.test(name));
  return{files,unknown};
 }
 async prepare(includeExports=false):Promise<ResetReview>{
  await this.cancel();await this.validateScope();
  const ownership=await inspectWorkspaceLease(this.storage);if(['other-window','uncertain'].includes(ownership.state))throw new Error('reset-ownership-unavailable');
  const directory=await SecureDirectory.open(this.storage);let collectorId:string;
  try{const previous=JSON.parse((await directory.read('publisher.json',4096)).bytes.toString('utf8'));if(typeof previous.collectorId!=='string')throw new Error('invalid-reset-scope');collectorId=previous.collectorId;}finally{await directory.close();}
  const workspaceId=hash('workspace\0'+this.root),config=await initializeSpool(this.storage,{collectorId,environmentId:'local-darwin-arm64',workspaceId},this.root,false);
  const owner=await SpoolIngester.openForScopedReset(this.storage,config,ownership.token);let retained=false;
  try{
   await owner.setPublisherEnabled(false);await owner.requireCollectorEpoch();await new Promise(resolve=>setTimeout(resolve,1600));
   const base=await SecureDirectory.open(this.storage);let existing:ResetIntent|undefined;
   try{try{existing=parseIntent(JSON.parse((await base.read('reset-intent.json',2048)).bytes.toString('utf8')),workspaceId,config.collectorId);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}finally{await base.close();}
   const intent=existing??{resetVersion:1 as const,workspaceId,oldEpoch:config.collectorId,newEpoch:randomUUID(),includeExports};const selected=await this.selection(intent);
   const review:ResetReview={token:randomUUID(),expiresAt:new Date(Date.now()+300000).toISOString(),workspaceId,includeExports:intent.includeExports,interrupted:Boolean(existing),files:selected.files.length,bytes:selected.files.reduce((n,f)=>n+f.bytes,0),preservedUnknownEntries:selected.unknown,
    categories:['source journal and retention/dedup metadata','pending telemetry in this collector generation and legacy flat inbox','projection checkpoint, diagnostic report and export staging','current-window aliases, attention controls and frozen/details snapshots',...(intent.includeExports?['saved local diagnostic exports']:[])],
    notes:['Collection remains off on cancellation. No native conversation, user file, foreign hook or original-hook backup is selected.','Counts describe this review; any new artifacts in the same selected categories are included at commit.','Unknown files are preserved. Unknown contents in an old generation can prevent safe completion.','Saved exports are retained unless explicitly selected. Other editor profiles and user-copied exports are outside this scope.']};
   const timer=setTimeout(()=>{void this.cancel().catch(()=>{});},300000);timer.unref();this.active={review,intent,owner,timer};retained=true;return JSON.parse(JSON.stringify(review)) as ResetReview;
  }finally{if(!retained)await owner.close();}
 }
 async commit(token:string):Promise<{removed:number;newEpoch:string}>{
  const active=this.active;if(!active||active.review.token!==token||Date.now()>=Date.parse(active.review.expiresAt))throw new Error('reset-review-expired');
  const {owner,intent}=active;clearTimeout(active.timer);this.active=undefined;let base:SecureDirectory|undefined,removed=0;
  try{
   base=await SecureDirectory.open(this.storage);await this.validateScope();await owner.assertOwner();await owner.setPublisherEnabled(false);await atomicPrivateJson(base,'reset-intent.json',intent,()=>owner.assertOwner());
   const selected=await this.selection(intent);
   for(const file of selected.files){const directory=await SecureDirectory.open(file.parent);try{await removePrivateFile(directory,file.name,()=>owner.assertOwner());await directory.sync();removed++;}finally{await directory.close();}}
   const inbox=await SecureDirectory.open(join(this.storage,'inbox'));
   try{for(const epoch of new Set([intent.oldEpoch,intent.newEpoch])){await owner.assertOwner();await inbox.guard();try{await rmdir(join(inbox.path,epoch));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw new Error('reset-generation-not-empty');}}await inbox.sync();}finally{await inbox.close();}
   await owner.rotateCollectorEpoch(intent.newEpoch);await removePrivateFile(base,'reset-intent.json',()=>owner.assertOwner());await base.sync();return{removed,newEpoch:intent.newEpoch};
  }finally{this.active=undefined;await base?.close();await owner.close();}
 }
 async cancel():Promise<void>{const active=this.active;this.active=undefined;if(active){clearTimeout(active.timer);await active.owner.close();}}
}
