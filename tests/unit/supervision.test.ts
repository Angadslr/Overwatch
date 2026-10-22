import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,writeFile,readFile,rm,mkdir,symlink,readdir,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {PluginManager} from '../../src/integration/pluginManager';
import {FixtureTargets} from '../../src/integration/fixtureTargets';

async function setup(t:{after:(fn:()=>Promise<void>)=>void}){
 const root=await realpath(await mkdtemp(join(tmpdir(),'overwatch-ui-')));t.after(()=>rm(root,{recursive:true,force:true}));
 await writeFile(join(root,'.overwatch-probe-fixture'),'overwatch-invented-fixture-v1\n');await writeFile(join(root,'read.txt'),'Invented fixture.\n');
 const helper=join(root,"helper's $(literal).sh");await writeFile(helper,"#!/bin/sh\nprintf '{}\\n'\n",{mode:0o700});
 let reason:string|undefined;
 const manager=new PluginManager({root,storage:join(root,'.local','supervision-storage'),helper,collectorId:'fixture-owner',eligibility:()=>reason,changed:()=>{}});
 t.after(async()=>{await manager.disable();});
 return {root,helper,manager,eligibility:(next:string|undefined)=>{reason=next;}};
}
test('owned fixture hooks use the Go launcher, omit unqualified sessionEnd and disable the publisher before removal',async t=>{
 const {root,helper,manager}=await setup(t);await manager.enable();
 const hooks=JSON.parse(await readFile(join(root,'.cursor','hooks.json'),'utf8')) as {hooks:Record<string,Array<{command:string}>>};
 assert.equal(Object.keys(hooks.hooks).length,13);assert.equal(hooks.hooks.sessionEnd,undefined);
 assert.ok(hooks.hooks.beforeReadFile?.[0]?.command.includes("'"));assert.ok(hooks.hooks.beforeReadFile?.[0]?.command.includes('literal'));
 assert.equal((await stat(join(root,'.cursor','hooks.json'))).mode&0o777,0o600);assert.equal(manager.enabled,true);
 assert.equal(await manager.disable(),'removed');assert.equal(manager.enabled,false);
 const storage=join(root,'.local','supervision-storage');assert.equal(JSON.parse(await readFile(join(storage,'publisher.json'),'utf8')).enabled,false);
 await assert.rejects(readFile(join(root,'.cursor','hooks.json')));
 await manager.enable();assert.equal(manager.enabled,true);assert.equal(await manager.disable(),'removed');
 assert.ok(helper.startsWith(root));
});
test('existing/modified hook configurations and active collector ownership are preserved',async t=>{
 const {root,manager,helper}=await setup(t);await mkdir(join(root,'.cursor'),{mode:0o755});
 const config=join(root,'.cursor','hooks.json'),existing='{"version":1,"hooks":{}}\n';await writeFile(config,existing,{mode:0o600});
 await assert.rejects(manager.enable());assert.equal(await readFile(config,'utf8'),existing);await rm(config);
 await manager.enable();const other=new PluginManager({root,storage:join(root,'.local','supervision-storage'),helper,collectorId:'fixture-owner',eligibility:()=>undefined,changed:()=>{}});
 await assert.rejects(other.enable());assert.equal(manager.enabled,true);await other.disable();
 const modified=(await readFile(config,'utf8'))+'\n';await writeFile(config,modified,{mode:0o600});
 assert.equal(await manager.disable(),'modified-preserved');assert.equal(await readFile(config,'utf8'),modified);
 assert.equal(JSON.parse(await readFile(join(root,'.local','supervision-storage','publisher.json'),'utf8')).enabled,false);
});
test('trust is checked before collection and loss of eligibility stops the owned publisher',async t=>{
 const {root,manager,eligibility}=await setup(t);eligibility('workspace-not-trusted');await assert.rejects(manager.enable(),/workspace-not-trusted/);
 assert.deepEqual((await readdir(root)).sort(),['.overwatch-probe-fixture',"helper's $(literal).sh",'read.txt'].sort());
 eligibility(undefined);await manager.enable();eligibility('workspace-not-trusted');manager.refresh();await manager.disable();
 assert.equal(manager.enabled,false);assert.equal(JSON.parse(await readFile(join(root,'.local','supervision-storage','publisher.json'),'utf8')).enabled,false);
});
test('fixture targets expose only known relative names and refuse missing, symlink or marker-substituted files',async t=>{
 const {root}=await setup(t),targets=new FixtureTargets(root);
 const hash=(p:string)=>createHash('sha256').update('path-hint\0'+p).digest('hex');
 const hint=hash(join(root,'read.txt'));assert.equal(targets.relativePath(hint),'read.txt');
 assert.deepEqual(await targets.resolve(hint),{ok:true,path:join(root,'read.txt'),relativePath:'read.txt'});
 assert.deepEqual(await targets.resolve(hash(join(root,'missing.txt'))),{ok:false,reason:'missing'});
 assert.deepEqual(await targets.resolve(hash(join(root,'private.env'))),{ok:false,reason:'unresolved'});
 await rm(join(root,'read.txt'));await symlink(join(root,'.overwatch-probe-fixture'),join(root,'read.txt'));
 assert.deepEqual(await targets.resolve(hint),{ok:false,reason:'unsafe'});
 await writeFile(join(root,'.overwatch-probe-fixture'),'different');assert.deepEqual(await targets.resolve(hash(join(root,'missing.txt'))),{ok:false,reason:'unsafe'});
});
test('symlinked fixture integration directories never publish to an unrelated location',async t=>{
 const {root,manager}=await setup(t);const outside=await realpath(await mkdtemp(join(tmpdir(),'overwatch-unrelated-')));t.after(()=>rm(outside,{recursive:true,force:true}));
 await symlink(outside,join(root,'.cursor'));await assert.rejects(manager.enable());assert.deepEqual(await readdir(outside),[]);
});
