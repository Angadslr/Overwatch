import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp,realpath,rm,writeFile,readFile,copyFile,chmod,access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
const bundled=resolve('.local/t20-manager.cjs');
await build({entryPoints:['src/integration/pluginManager.ts'],outfile:bundled,bundle:true,platform:'node',format:'cjs',target:'node22',logLevel:'silent'});
const require=createRequire(import.meta.url),{PluginManager}=require(bundled),helper=resolve('dist/cursor-supervision-hook');
test('installed shell launchers respond exactly once despite missing, non-executable or noisy failing helpers',async t=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'overwatch-launcher-')));t.after(()=>rm(root,{recursive:true,force:true}));await writeFile(join(root,'.overwatch-probe-fixture'),'overwatch-invented-fixture-v1\n');const trusted=join(root,'trusted helper');await copyFile(helper,trusted);await chmod(trusted,0o700);
 const manager=new PluginManager({root,storage:join(root,'.local','supervision-storage'),helper:trusted,collectorId:'owner',eligibility:()=>undefined,changed:()=>{}});await manager.enable();
 try{const hooks=JSON.parse(await readFile(join(root,'.cursor','hooks.json'),'utf8')).hooks;
  for(const mode of ['missing','non-executable','noisy-failure']){
   if(mode==='missing')await rm(trusted);else{await writeFile(trusted,mode==='noisy-failure'?"#!/bin/sh\nprintf 'FORBIDDEN_STDOUT'; printf 'FORBIDDEN_STDERR' >&2; exit 7\n":"#!/bin/sh\nexit 1\n",{mode:0o600});await chmod(trusted,mode==='noisy-failure'?0o700:0o600);}
   for(const hook of ['beforeReadFile','afterFileEdit','subagentStart','stop']){const result=await new Promise((resolveResult,reject)=>{const child=spawn('/bin/sh',['-c',hooks[hook][0].command],{stdio:['pipe','pipe','pipe']});let stdout='',stderr='';const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('launcher-timeout'));},2000);child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);child.on('error',reject);child.on('close',code=>{clearTimeout(timer);resolveResult({code,stdout,stderr});});child.stdin.end('{}');});assert.deepEqual(result,{code:0,stdout:['beforeReadFile','subagentStart'].includes(hook)?'{"permission":"allow"}\n':'{}\n',stderr:''});}
  }
 }finally{await manager.disable();}
});
test('a competing collector stays passive; SIGKILL permits proven recovery and an owned helper upgrade across profiles',async t=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'overwatch-owner-')));t.after(()=>rm(root,{recursive:true,force:true}));
 await writeFile(join(root,'.overwatch-probe-fixture'),'overwatch-invented-fixture-v1\n');await writeFile(join(root,'read.txt'),'Invented.\n');const storage=join(root,'.local','supervision-storage');
 const script=`const {PluginManager}=require(process.argv[1]);const manager=new PluginManager({root:process.argv[2],storage:process.argv[3],helper:process.argv[4],collectorId:'first-profile',eligibility:()=>undefined,changed:()=>{}});manager.enable().then(()=>process.send('ready')).catch(()=>process.exit(1));setInterval(()=>{},1000);`;
 const child=spawn(process.execPath,['-e',script,bundled,root,storage,helper],{stdio:['ignore','ignore','ignore','ipc']});t.after(()=>{if(child.exitCode===null)child.kill('SIGKILL');});
 const timeout=setTimeout(()=>child.kill('SIGKILL'),5000);const message=await Promise.race([once(child,'message'),once(child,'exit').then(()=>{throw new Error('owner-exited-before-enable');})]);clearTimeout(timeout);assert.equal(message[0],'ready');
 const hooks=await readFile(join(root,'.cursor','hooks.json'),'utf8'),publisher=await readFile(join(storage,'publisher.json'),'utf8'),lease=await readFile(join(storage,'collector.lock'),'utf8');
 const passive=new PluginManager({root,storage,helper,collectorId:'second-profile',eligibility:()=>undefined,changed:()=>{}});await assert.rejects(passive.enable(),/workspace-owned-by-other-window/);assert.equal(passive.readiness().ownership,'other-window');await passive.disable();
 assert.equal(await readFile(join(root,'.cursor','hooks.json'),'utf8'),hooks);assert.equal(await readFile(join(storage,'publisher.json'),'utf8'),publisher);assert.equal(await readFile(join(storage,'collector.lock'),'utf8'),lease);
 const exited=once(child,'exit');child.kill('SIGKILL');await exited;
 const upgraded=join(root,'new trusted helper');await copyFile(helper,upgraded);await chmod(upgraded,0o700);
 const recovered=new PluginManager({root,storage,helper:upgraded,collectorId:'upgrade-profile',eligibility:()=>undefined,changed:()=>{}});
 try{await recovered.enable();assert.equal(recovered.readiness().ownership,'owned');const config=JSON.parse(await readFile(join(storage,'publisher.json'),'utf8'));assert.equal(config.collectorId,'first-profile');assert.ok((await readFile(join(root,'.cursor','hooks.json'),'utf8')).includes('new trusted helper'));assert.equal((await recovered.runSelfCheck()).state,'passed');assert.equal(recovered.health.snapshot().nativeDelivery,'awaiting-first-event');}
 finally{await recovered.disable();}
 await assert.rejects(access(join(root,'.cursor','hooks.json')));await assert.rejects(access(join(storage,'collector.lock')));await assert.rejects(access(join(storage,'hook-ownership.json')));assert.equal(JSON.parse(await readFile(join(storage,'publisher.json'),'utf8')).enabled,false);
});
