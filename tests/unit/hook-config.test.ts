import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,rm,mkdir,writeFile,readFile,link,access} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {initializeSpool,SpoolIngester} from '../../src/transport/spoolIngester';
import {installOwnedHooks,restoreOwnedHooks,removeHookOwnership,hookBytes} from '../../src/integration/hookConfig';
async function setup(t:{after:(fn:()=>Promise<void>)=>void}){
 const root=await realpath(await mkdtemp(join(tmpdir(),'hook-config-')));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(join(root,'.cursor'),{mode:0o700});const storage=join(root,'storage');await mkdir(storage,{mode:0o700});const config=await initializeSpool(storage,{collectorId:'owner',environmentId:'local',workspaceId:'root'},root,false);const owner=await SpoolIngester.open(storage,config);t.after(()=>owner.close());return{root,storage,owner,guard:()=>owner.assertOwner()};
}
test('an interrupted linked install reclaims only proven staging and upgrades without an orphan hardlink',async t=>{
 const {root,storage,guard}=await setup(t);const owned=await installOwnedHooks(root,storage,'/trusted/old-helper',guard);await owned.directory.close();
 const stage=join(root,'.cursor','overwatch-'+randomUUID()+'.tmp');await link(join(root,'.cursor','hooks.json'),stage);
 const upgraded=await installOwnedHooks(root,storage,'/trusted/new-helper',guard);try{await assert.rejects(access(stage));assert.ok(upgraded.bytes.includes('/trusted/new-helper'));assert.equal(await restoreOwnedHooks(upgraded,root,storage,guard),'removed');await removeHookOwnership(storage,guard);}finally{await upgraded.directory.close();}
});
test('an interrupted merge before replacement recognizes the saved original without a second opt-in',async t=>{
 const {root,storage,guard}=await setup(t),path=join(root,'.cursor','hooks.json'),original='{"version":1,"hooks":{},"unknown":{"preserve":true}}\n';await writeFile(path,original,{mode:0o600});
 const owned=await installOwnedHooks(root,storage,'/trusted/helper',guard,true);await owned.directory.close();await writeFile(path,original);
 const recovered=await installOwnedHooks(root,storage,'/trusted/upgraded-helper',guard,false);try{assert.equal(await restoreOwnedHooks(recovered,root,storage,guard),'removed');assert.equal(await readFile(path,'utf8'),original);}finally{await recovered.directory.close();}
});
test('unproven staging is preserved and prevents installation rather than being deleted as debris',async t=>{
 const {root,storage,guard}=await setup(t),stage=join(root,'.cursor','overwatch-'+randomUUID()+'.tmp');await writeFile(stage,'foreign-state',{mode:0o600});await assert.rejects(installOwnedHooks(root,storage,'/trusted/helper',guard),/hook-staging-uncertain/);assert.equal(await readFile(stage,'utf8'),'foreign-state');await assert.rejects(access(join(root,'.cursor','hooks.json')));
});
test('the recognized pre-wrapper configuration upgrades without losing structural ownership',async t=>{
 const {root,storage,guard}=await setup(t),helper='/trusted/helper',path=join(root,'.cursor','hooks.json');const owned=await installOwnedHooks(root,storage,helper,guard);await owned.directory.close();
 const recordPath=join(storage,'hook-ownership.json'),record=JSON.parse(await readFile(recordPath,'utf8'));record.installations[0].bytes=hookBytes(helper,storage,null,false);await writeFile(recordPath,JSON.stringify(record));await writeFile(path,record.installations[0].bytes);
 const upgraded=await installOwnedHooks(root,storage,helper,guard);try{assert.ok(upgraded.bytes.includes('printf'));assert.equal(await restoreOwnedHooks(upgraded,root,storage,guard),'removed');}finally{await upgraded.directory.close();}
});
