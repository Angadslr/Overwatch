import * as vscode from 'vscode';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile,writeFile,readdir,access} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import type {SupervisionApi} from '../../src/commands';

export async function run():Promise<void>{
 const resultPath=process.env.OVERWATCH_EXTENSION_RESULT;
 if(!resultPath)throw new Error('test-result-path-required');
 const checks:string[]=[];let api:SupervisionApi|undefined;
 const root=vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
 const base={suite:'T08 real Cursor extension host',nativeDelivery:false,editorApiVersion:vscode.version,extensionHostNode:process.versions.node,startedAt:new Date().toISOString()};
 try{
  assert.ok(root);assert.equal((await readFile(join(root,'.overwatch-probe-fixture'),'utf8')).trim(),'overwatch-invented-fixture-v1');
  const extension=vscode.extensions.getExtension<SupervisionApi>('angad-local.overwatch-native-probe');assert.ok(extension);api=await extension.activate();
  if(!vscode.workspace.isTrusted){
   const blocked=await vscode.commands.executeCommand<{ok:boolean}>('overwatch.supervision.enable');assert.equal(blocked?.ok,false);checks.push('real-host untrusted enable refused');
   await new Promise<void>((resolve,reject)=>{const timeout=setTimeout(()=>{listener.dispose();reject(new Error('fixture-trust-not-granted'));},120000);const listener=vscode.workspace.onDidGrantWorkspaceTrust(()=>{clearTimeout(timeout);listener.dispose();resolve();});});
  }
  assert.ok(api.manager&&api.tree);assert.equal((await vscode.commands.executeCommand<{ok:boolean}>('overwatch.supervision.enable'))?.ok,true);checks.push('trusted owned collection enabled');
  const helper=join(extension.extensionPath,'dist','cursor-supervision-hook'),storage=join(root,'.local','supervision-storage');
  const conversation='t08-host-synthetic-'+randomUUID();
  const sessionHash=createHash('sha256').update('conversation\0'+conversation).digest('hex');
  async function invoke(hook:string,path:string):Promise<void>{
   await new Promise<void>((resolve,reject)=>{
    const child=spawn(helper,[hook,storage],{stdio:['pipe','pipe','pipe']});let stdout='',stderr='';const timeout=setTimeout(()=>{child.kill();reject(new Error('hook-timeout'));},5000);
    child.stdout.on('data',b=>{stdout+=b;});child.stderr.on('data',b=>{stderr+=b;});child.on('error',reject);child.stdin.on('error',()=>{});
    child.on('close',code=>{clearTimeout(timeout);try{assert.equal(code,0);assert.equal(stderr,'');assert.equal(stdout,hook==='beforeReadFile'?'{"permission":"allow"}\n':'{}\n');resolve();}catch(error){reject(error);}});
    child.stdin.end(JSON.stringify({hook_event_name:hook,cursor_version:'3.26.16',workspace_roots:[root],conversation_id:conversation,generation_id:'turn',tool_use_id:path==='read.txt'?'read-call':'missing-call',tool_name:'Read',file_path:join(root!,path),tool_output:'FAKE_SECRET_MARKER',prompt:'FAKE_SECRET_MARKER'}));
   });
  }
  await invoke('beforeReadFile','read.txt');await invoke('postToolUse','read.txt');await invoke('afterFileEdit','edit.txt');await invoke('beforeReadFile','missing.txt');
  const deadline=Date.now()+10000;
  while([...api.manager.evidence.values()].filter(o=>o.event.conversationId===sessionHash).length<4&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,50));
  api.manager.refresh();
  const groups=api.tree.getChildren(),nodes=groups.flatMap(n=>api!.tree!.getChildren(n)).filter(n=>n.observation?.event.conversationId===sessionHash);
  const read=nodes.find(n=>n.label==='read.txt');assert.ok(read);
  const item=api.tree.getTreeItem(read);assert.ok(String(item.description).includes('Read completed'));assert.ok(String(item.description).includes('ago'));assert.ok(String(item.tooltip).includes('Source session:'));
  assert.ok(nodes.some(n=>n.label==='edit.txt'&&n.description.includes('Edit reported')));checks.push('real TreeItems contain relative paths identity evidence and age');
  assert.ok(item.command);const opened=await vscode.commands.executeCommand<{ok:boolean}>(item.command.command,...(item.command.arguments??[]));assert.equal(opened?.ok,true);assert.equal(vscode.window.activeTextEditor?.document.uri.fsPath,join(root,'read.txt'));checks.push('selection opens intended current fixture file');
  const missingHint=createHash('sha256').update('path-hint\0'+join(root,'missing.txt')).digest('hex');
  const missing=await vscode.commands.executeCommand<{ok:boolean;reason:string}>('overwatch.supervision.openFile',missingHint);assert.equal(missing?.ok,false);assert.equal(missing?.reason,'missing');checks.push('missing current file is reported accurately');
  assert.equal(JSON.stringify(api.snapshot()).includes('FAKE_SECRET_MARKER'),false);checks.push('content markers absent from extension projection');
  await api.disable();assert.equal(api.manager.enabled,false);await assert.rejects(access(join(root,'.cursor','hooks.json')));assert.equal(JSON.parse(await readFile(join(storage,'publisher.json'),'utf8')).enabled,false);checks.push('disable removes owned hook config and stops publishing');
  const before=await readdir(join(storage,'inbox'));await invoke('beforeReadFile','read.txt');assert.deepEqual(await readdir(join(storage,'inbox')),before);checks.push('cached command remains observational and cannot publish after disable');
  await writeFile(resultPath,JSON.stringify({...base,finishedAt:new Date().toISOString(),passed:true,checks},null,2));
 }catch{
  await writeFile(resultPath,JSON.stringify({...base,finishedAt:new Date().toISOString(),passed:false,checks,failure:'extension-host-verification-failed'},null,2));
  throw new Error('extension-host-verification-failed');
 }finally{await api?.disable();}
}
