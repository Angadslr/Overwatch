import { constants, type Stats } from 'node:fs';
import { open, link, rename, unlink, lstat, opendir } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { join, isAbsolute } from 'node:path';
import { SecureDirectory, sameFile } from '../transport/secureFs';
import { atomicPrivateJson, removePrivateFile } from '../transport/retention';
import { PROBE_HOOKS, PERMISSION_HOOKS, quotePosix } from './probe';
import { parseTree, type Node as JsonNode, type ParseError } from 'jsonc-parser/lib/esm/main.js';
import {OPAQUE_PATTERN} from '../transport/sourceValidation';
interface Installation { helper: string; bytes: string; collectorId?:string }
interface OwnershipRecord { ownershipVersion: 1; rootHash: string; storageHash: string; original: string | null; installations: Installation[] }
export interface OwnedHooks { directory: SecureDirectory; bytes: string; inode: Stats }
const hash = (s: string): string => createHash('sha256').update(s).digest('hex');
function hookDocument(original:string):Record<string,unknown>&{hooks:Record<string,unknown>} {
  if(Buffer.byteLength(original)>32768)throw new Error('existing-hooks-too-large');
  const errors:ParseError[]=[],tree=parseTree(original,errors,{disallowComments:true,allowTrailingComma:false});
  let nodes=0;function check(node:JsonNode,depth:number):void{if(++nodes>5000||depth>32)throw new Error('existing-hooks-invalid');if(node.type==='object'){const keys=new Set<string>();for(const p of node.children??[]){const key=p.children?.[0]?.value;if(typeof key!=='string'||keys.has(key))throw new Error('existing-hooks-invalid');keys.add(key);}}for(const child of node.children??[])check(child,depth+1);}
  if(!tree||errors.length)throw new Error('existing-hooks-invalid');check(tree,0);
  const doc=JSON.parse(original);if(!doc||Array.isArray(doc)||doc.version!==1||!doc.hooks||typeof doc.hooks!=='object'||Array.isArray(doc.hooks))throw new Error('existing-hooks-invalid');
  for(const hook of PROBE_HOOKS){const entries=doc.hooks[hook];if(entries!==undefined&&(!Array.isArray(entries)||entries.some(e=>!e||typeof e!=='object'||typeof e.command!=='string'||e.command.includes('cursor-supervision-hook'))))throw new Error('existing-hooks-invalid');}
  return doc;
}
export function observationCommand(helper:string,hook:string,storage:string,collectorId?:string):string{
 const response=(PERMISSION_HOOKS as readonly string[]).includes(hook)?'{"permission":"allow"}':'{}';
 return `printf '%s\\n' ${quotePosix(response)}; ${[helper,hook,storage,...(collectorId?[collectorId]:[])].map(quotePosix).join(' ')} >/dev/null 2>&1 || :`;
}
export function hookBytes(helper: string, storage: string, original:string|null=null, protectedLauncher=true,collectorId?:string): string {
  const command = (hook: string): string => protectedLauncher?observationCommand(helper,hook,storage,collectorId):[helper, hook, storage].map(quotePosix).join(' ');
  const doc=original===null?{version:1,hooks:{} as Record<string,unknown>}:hookDocument(original);
  const hooks={...doc.hooks};for(const hook of PROBE_HOOKS.filter(h=>h!=='sessionEnd'))hooks[hook]=[...((hooks[hook]??[]) as unknown[]),{command:command(hook),timeout:3}];
  const bytes=JSON.stringify({...doc,hooks},null,2)+'\n';if(Buffer.byteLength(bytes)>65536)throw new Error('generated-hooks-too-large');return bytes;
}
async function ownershipRecord(storage: SecureDirectory, root: string): Promise<OwnershipRecord | undefined> {
  try {
    const read = await storage.read('hook-ownership.json', 256*1024), record = JSON.parse(read.bytes.toString('utf8')) as OwnershipRecord;
    if (!record || Object.keys(record).sort().join(',') !== 'installations,original,ownershipVersion,rootHash,storageHash' || record.ownershipVersion!==1 || (record.original!==null&&typeof record.original!=='string') ||
      record.rootHash!==hash(root) || record.storageHash!==hash(storage.path) || !Array.isArray(record.installations) || record.installations.length<1 || record.installations.length>2 || read.info.nlink!==1 ||
      record.installations.some(i=>!i || !['bytes,helper','bytes,collectorId,helper'].includes(Object.keys(i).sort().join(',')) || typeof i.helper!=='string' || !isAbsolute(i.helper) || i.helper.length>4096 ||
        (i.collectorId!==undefined&&(typeof i.collectorId!=='string'||!OPAQUE_PATTERN.test(i.collectorId))) ||
        (i.bytes!==hookBytes(i.helper,storage.path,record.original,true,i.collectorId)&&(i.collectorId!==undefined||i.bytes!==hookBytes(i.helper,storage.path,record.original,false))))) throw new Error('hook-ownership-invalid');
    return record;
  } catch(error) { if((error as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw error; }
}
async function cleanHookStaging(directory:SecureDirectory,proof:OwnershipRecord|undefined,ownsLease:()=>Promise<void>):Promise<void>{
 const listing=await opendir(directory.path);let entries=0;
 try{while(true){const entry=await listing.read();if(!entry)break;if(++entries>256)throw new Error('hook-directory-limit');if(!/^overwatch-[0-9a-f-]{36}\.tmp$/.test(entry.name))continue;
  const read=await directory.read(entry.name,65536),bytes=read.bytes.toString('utf8');
  if(read.info.nlink>2||!proof||!(proof.original===bytes||proof.installations.some(i=>i.bytes===bytes)))throw new Error('hook-staging-uncertain');
  await ownsLease();await directory.guard();if(!sameFile(read.info,await lstat(join(directory.path,entry.name))))throw new Error('hook-staging-changed');await unlink(join(directory.path,entry.name));
 }}finally{await listing.close();}await directory.sync();
}
/** Existing hooks require an explicit setting; the exact original is kept private for conditional restoration. */
export async function installOwnedHooks(root: string, storagePath: string, helper: string, ownsLease:()=>Promise<void>, allowExisting=false,collectorId?:string): Promise<OwnedHooks> {
  const directory = await SecureDirectory.open(join(root,'.cursor'),false), storage = await SecureDirectory.open(storagePath);
  const temporary=`overwatch-${randomUUID()}.tmp`;
  try {
    await ownsLease();const proof=await ownershipRecord(storage,root);
    await cleanHookStaging(directory,proof,ownsLease);
    let current:Awaited<ReturnType<SecureDirectory['read']>>|undefined;
    try {current=await directory.read('hooks.json',65536);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    const previous=current&&proof?.installations.find(i=>i.bytes===current!.bytes.toString('utf8'));
    const originalStillPresent=Boolean(current&&proof?.original!==null&&proof?.original===current.bytes.toString('utf8'));
    if(current&&current.info.nlink!==1)throw new Error('foreign-or-modified-hooks');
    if(current&&!previous&&!originalStillPresent&&(proof||!allowExisting))throw new Error('foreign-or-modified-hooks');
    if(!current&&proof?.original!==null&&proof?.original!==undefined)throw new Error('foreign-or-modified-hooks');
    const original=previous||originalStillPresent?proof!.original:current?current.bytes.toString('utf8'):null;
    if(collectorId!==undefined&&!OPAQUE_PATTERN.test(collectorId))throw new Error('invalid-collector-epoch');
    const bytes=hookBytes(helper,storagePath,original,true,collectorId);
    const installation:Installation={helper,bytes,...(collectorId?{collectorId}:{})};
    const record:OwnershipRecord={ownershipVersion:1,rootHash:hash(root),storageHash:hash(storagePath),original,installations:previous&&previous.bytes!==bytes?[previous,installation]:[installation]};
    // Both old and new generated bytes remain proven across an interrupted upgrade.
    await atomicPrivateJson(storage,'hook-ownership.json',record,ownsLease);
    await directory.guard();
    const file=await open(join(directory.path,temporary),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
    let inode:Stats;try{await file.writeFile(bytes);await file.sync();inode=await file.stat();}finally{await file.close();}
    await ownsLease();await directory.guard();
    if(current){if(!sameFile(current.info,await lstat(join(directory.path,'hooks.json')))||(await directory.read('hooks.json',65536)).bytes.toString('utf8')!==current.bytes.toString('utf8'))throw new Error('hook-config-changed');
      await rename(join(directory.path,temporary),join(directory.path,'hooks.json'));
    }else await link(join(directory.path,temporary),join(directory.path,'hooks.json'));
    await directory.sync();
    await atomicPrivateJson(storage,'hook-ownership.json',{...record,installations:[installation]},ownsLease);
    return {directory,bytes,inode};
  }catch(error){await directory.close();throw error;}
  finally{await unlink(join(root,'.cursor',temporary)).catch(()=>{});await storage.close();}
}
export async function removeHookOwnership(storagePath:string,ownsLease:()=>Promise<void>):Promise<void>{
  const storage=await SecureDirectory.open(storagePath);try{await removePrivateFile(storage,'hook-ownership.json',ownsLease);await storage.sync();}finally{await storage.close();}
}
export async function restoreOwnedHooks(owned:OwnedHooks,root:string,storagePath:string,ownsLease:()=>Promise<void>):Promise<'removed'|'modified-preserved'|'not-installed'>{
 const storage=await SecureDirectory.open(storagePath);let temporary:string|undefined;
 try{
  await ownsLease();const record=await ownershipRecord(storage,root);
  if(!record?.installations.some(i=>i.bytes===owned.bytes))return 'modified-preserved';
  let current;try{current=await owned.directory.read('hooks.json',65536);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return 'not-installed';return 'modified-preserved';}
  if(current.info.nlink!==1||!sameFile(current.info,owned.inode)||current.bytes.toString('utf8')!==owned.bytes)return 'modified-preserved';
  if(record.original!==null){temporary=`overwatch-${randomUUID()}.tmp`;const file=await open(join(owned.directory.path,temporary),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);try{await file.writeFile(record.original);await file.sync();}finally{await file.close();}}
  await ownsLease();await owned.directory.guard();const before=await owned.directory.read('hooks.json',65536);
  if(!sameFile(before.info,owned.inode)||before.bytes.toString('utf8')!==owned.bytes)return 'modified-preserved';
  if(temporary)await rename(join(owned.directory.path,temporary),join(owned.directory.path,'hooks.json'));else await unlink(join(owned.directory.path,'hooks.json'));
  await owned.directory.sync();return 'removed';
 }finally{if(temporary)await unlink(join(owned.directory.path,temporary)).catch(()=>{});await storage.close();}
}
