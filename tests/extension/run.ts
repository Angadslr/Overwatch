import * as vscode from 'vscode';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile,writeFile,readdir,access} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import type {SupervisionApi} from '../../src/commands';
import {ConversationIdentities} from '../../src/core/identity';
import {verifyLocalObservations,verifyLocalObservationDisposal} from './fileObservations';
import {verifyViews,verifyPrivacy} from './views';
import {verifyActivity} from './activity';
import {verifySelfCheck,verifyAttention} from './attention-health';
import {verifyOnboarding} from './onboarding';
import {verifyPerformance} from './performance';
import {verifyMaintenance} from './maintenance';

export async function run():Promise<void>{
 const resultPath=process.env.OVERWATCH_EXTENSION_RESULT;
 if(!resultPath)throw new Error('test-result-path-required');
 const checks:string[]=[];let api:SupervisionApi|undefined;let stage='fixture';
 const root=vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
 const base={suite:'T23 reviewed local export, scoped history reset and installed-host regression',nativeDelivery:false,editorApiVersion:vscode.version,extensionHostNode:process.versions.node,startedAt:new Date().toISOString()};
 try{
  assert.ok(root);assert.equal((await readFile(join(root,'.overwatch-probe-fixture'),'utf8')).trim(),'overwatch-invented-fixture-v1');
  stage='activation';const extension=vscode.extensions.getExtension<SupervisionApi>('angad-local.overwatch-native-probe');assert.ok(extension);api=await extension.activate();
  if(!vscode.workspace.isTrusted){
   const blocked=await vscode.commands.executeCommand<{ok:boolean}>('overwatch.supervision.enable');assert.equal(blocked?.ok,false);checks.push('real-host untrusted enable refused');
   await new Promise<void>((resolve,reject)=>{const timeout=setTimeout(()=>{listener.dispose();reject(new Error('fixture-trust-not-granted'));},120000);const listener=vscode.workspace.onDidGrantWorkspaceTrust(()=>{clearTimeout(timeout);listener.dispose();resolve();});});
  }
  stage='enable';assert.ok(api.manager&&api.tree);assert.equal((await vscode.commands.executeCommand<{ok:boolean}>('overwatch.supervision.enable'))?.ok,true);checks.push('trusted owned collection enabled');stage='projection';
  assert.equal(api.manager.health.snapshot().publisherConfigured,true);assert.equal(api.manager.health.snapshot().nativeDelivery,'awaiting-first-event');
  if(process.env.OVERWATCH_PERFORMANCE_ONLY==='1'){
   stage='performance';checks.push(...await verifyPerformance(api,root));await writeFile(resultPath,JSON.stringify({...base,finishedAt:new Date().toISOString(),passed:true,checks},null,2));return;
  }
  checks.push('collector readiness awaits a fresh source event instead of verifying native delivery');
  stage='self-check';checks.push(...await verifySelfCheck(api));
  stage='local-observations';checks.push(...await verifyLocalObservations(api,root));stage='projection';
  const helper=join(extension.extensionPath,'dist','cursor-supervision-hook'),storage=join(root,'.local','supervision-storage');
  const conversation='t08-host-synthetic-'+randomUUID();
  const sessionHash=createHash('sha256').update('conversation\0'+conversation).digest('hex');
  async function invoke(hook:string,path:string,extra:Record<string,unknown>={}):Promise<void>{
   const epoch=JSON.parse(await readFile(join(storage,'publisher.json'),'utf8')).collectorId as string;
   await new Promise<void>((resolve,reject)=>{
    const child=spawn(helper,[hook,storage,epoch],{stdio:['pipe','pipe','pipe']});let stdout='',stderr='';const timeout=setTimeout(()=>{child.kill();reject(new Error('hook-timeout'));},5000);
    child.stdout.on('data',b=>{stdout+=b;});child.stderr.on('data',b=>{stderr+=b;});child.on('error',reject);child.stdin.on('error',()=>{});
    child.on('close',code=>{clearTimeout(timeout);try{assert.equal(code,0);assert.equal(stderr,'');assert.equal(stdout,['preToolUse','beforeReadFile','beforeShellExecution','beforeMCPExecution','subagentStart'].includes(hook)?'{"permission":"allow"}\n':'{}\n');resolve();}catch(error){reject(error);}});
    child.stdin.end(JSON.stringify({hook_event_name:hook,cursor_version:'3.26.16',workspace_roots:[root],conversation_id:conversation,generation_id:'turn',tool_use_id:path==='read.txt'?'read-call':'missing-call',tool_name:'Read',file_path:join(root!,path),tool_output:'FAKE_SECRET_MARKER',prompt:'FAKE_SECRET_MARKER',...extra}));
   });
  }
  await invoke('beforeReadFile','read.txt');await invoke('postToolUse','read.txt');await invoke('afterFileEdit','edit.txt');await invoke('beforeReadFile','missing.txt');
  const deadline=Date.now()+10000;
  while([...api.manager.evidence.values()].filter(o=>o.event.conversationId===sessionHash).length<4&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,50));
  api.manager.refresh();
  assert.equal(api.manager.health.snapshot().nativeDelivery,'source-event-observed');assert.equal(api.manager.health.snapshot().sourceCoverage,'partial');
  checks.push('fresh source delivery remains separate from partial source coverage');
  const groups=api.tree.getChildren(),nodes=groups.flatMap(n=>api!.tree!.getChildren(n)).filter(n=>n.observation?.event.conversationId===sessionHash);
  const read=nodes.find(n=>n.label==='read.txt');assert.ok(read);
  const item=api.tree.getTreeItem(read);assert.ok(String(item.description).includes('Read completed'));assert.ok(String(item.description).includes('ago'));assert.ok(String(item.tooltip).includes('Source session:'));
  assert.ok(nodes.some(n=>n.label==='edit.txt'&&n.description.includes('Edit reported')));checks.push('real TreeItems contain relative paths identity evidence and age');
  const session=api.manager.identities.snapshot().sessions.find(s=>s.sourceId===sessionHash);assert.ok(session);
  assert.ok(groups.some(g=>g.label.startsWith(session.alias+' · ')));
  const restored=new ConversationIdentities(JSON.parse(JSON.stringify(api.manager.identities.aliasState())));
  const readEvent=read.observation!.event;restored.observe({...readEvent,generationId:'another-turn'});
  assert.equal(restored.snapshot().sessions.find(s=>s.sourceId===sessionHash)?.alias,session.alias);
  checks.push('native session TreeItems use scoped aliases stable across turn and state restore');
  await invoke('subagentStart','read.txt',{subagent_id:'fixture-child',parent_conversation_id:conversation});
  await invoke('subagentStop','read.txt',{subagent_id:'fixture-child',parent_conversation_id:conversation,status:'completed'});
  const childDeadline=Date.now()+10000;
  while(!api.manager.identities.snapshot().children.some(c=>c.parents.includes(session.key)&&c.terminalReports.includes('completed'))&&Date.now()<childDeadline)
    await new Promise(resolve=>setTimeout(resolve,50));
  const parent=api.tree.getChildren().find(n=>n.id===session.key);assert.ok(parent);
  const child=api.tree.getChildren(parent).find(n=>n.kind==='child');assert.ok(child);
  const childItem=api.tree.getTreeItem(child);assert.ok(String(childItem.description).includes('completed'));
  assert.ok(String(childItem.tooltip).includes('Child-to-file ownership: unverified'));
  checks.push('proven child lifecycle renders beneath its parent without assigning file ownership');
  stage='lifecycles';
  await invoke('stop','read.txt',{status:'completed'});
  const turnDeadline=Date.now()+10000;
  while(!api.manager.lifecycle.snapshot().turns.some(t=>t.conversationKey===session.key&&t.state==='complete')&&Date.now()<turnDeadline)
    await new Promise(resolve=>setTimeout(resolve,50));
  const finished=api.manager.lifecycle.snapshot().turns.find(t=>t.conversationKey===session.key&&t.state==='complete');assert.ok(finished);
  assert.equal(api.manager.lifecycle.snapshot().conversations.find(c=>c.key===session.key)?.available,true);
  const turnParent=api.tree.getChildren().find(n=>n.id===session.key);assert.ok(turnParent);
  assert.ok(String(api.tree.getTreeItem(turnParent).description).includes('Turn complete'));
  await invoke('beforeReadFile','read.txt',{generation_id:'turn-2'});
  const nextDeadline=Date.now()+10000;
  while(api.manager.lifecycle.snapshot().turns.filter(t=>t.conversationKey===session.key).length<2&&Date.now()<nextDeadline)
    await new Promise(resolve=>setTimeout(resolve,50));
  assert.equal(api.manager.lifecycle.snapshot().turns.find(t=>t.key===finished.key)?.state,'complete');
  assert.ok(api.manager.lifecycle.snapshot().turns.some(t=>t.conversationKey===session.key&&t.state==='activity-observed'));
  checks.push('completed generation stays terminal while its available conversation accepts another turn');
  assert.ok(item.command);const opened=await vscode.commands.executeCommand<{ok:boolean}>(item.command.command,...(item.command.arguments??[]));assert.equal(opened?.ok,true);assert.equal(vscode.window.activeTextEditor?.document.uri.fsPath,join(root,'read.txt'));checks.push('selection opens intended current fixture file');
  const missingHint=createHash('sha256').update('path-hint\0'+join(root,'missing.txt')).digest('hex');
  const missing=await vscode.commands.executeCommand<{ok:boolean;reason:string}>('overwatch.supervision.openFile',missingHint);assert.equal(missing?.ok,false);assert.equal(missing?.reason,'missing');checks.push('missing current file is reported accurately');
  assert.equal(JSON.stringify(api.snapshot()).includes('FAKE_SECRET_MARKER'),false);checks.push('content markers absent from extension projection');
  await api.disable();assert.equal(api.manager.enabled,false);await assert.rejects(access(join(root,'.cursor','hooks.json')));assert.equal(JSON.parse(await readFile(join(storage,'publisher.json'),'utf8')).enabled,false);checks.push('disable removes owned hook config and stops publishing');
  const before=await readdir(join(storage,'inbox'));await invoke('beforeReadFile','read.txt');assert.deepEqual(await readdir(join(storage,'inbox')),before);checks.push('cached command remains observational and cannot publish after disable');
  stage='replay';
  assert.equal((await vscode.commands.executeCommand<{ok:boolean}>('overwatch.supervision.enable'))?.ok,true);
  assert.equal(api.manager.readiness().checkpoint,'loaded');
  assert.ok((api.manager.readiness().history?.retainedRecords??0)>0);
  checks.push('clean disable saves a validated policy-bound checkpoint and reenable loads retained history');
  assert.equal(api.manager.health.snapshot().nativeDelivery,'awaiting-first-event');
  assert.ok(api.manager.store.snapshot().operations.some(o=>o.liveState==='unknown-after-reload'));
  assert.ok(api.tree.getChildren().flatMap(n=>api!.tree!.getChildren(n)).some(n=>n.description.includes('Live state unknown after reload')));
  assert.equal(api.manager.lifecycle.snapshot().turns.find(t=>t.key===finished.key)?.state,'complete');
  checks.push('replayed open operations render live-unknown and history cannot verify fresh delivery');
  await invoke('postToolUse','read.txt',{generation_id:'turn-2'});
  const completionDeadline=Date.now()+10000;
  while(api.manager.store.snapshot().operations.filter(o=>o.operation==='read'&&o.state==='completed').length<2&&Date.now()<completionDeadline)
    await new Promise(resolve=>setTimeout(resolve,50));
  assert.equal(api.manager.store.snapshot().operations.filter(o=>o.operation==='read'&&o.state==='completed').length,2);
  assert.equal(api.manager.health.snapshot().nativeDelivery,'source-event-observed');
  checks.push('fresh matching completion resolves a replayed request without changing the earlier turn');
  stage='views';checks.push(...await verifyViews(api,root,invoke));
  stage='attention';checks.push(...await verifyAttention(api));
  stage='activity';checks.push(...await verifyActivity(api,root,extension.extensionPath,invoke));
  stage='privacy';checks.push(...await verifyPrivacy(api,root,invoke));
  assert.equal(api.display.frozen,false);assert.ok(api.details.snapshot().text.includes('unavailable'));checks.push('privacy changes invalidate frozen display and open details metadata');
  await api.disable();assert.equal(api.manager.health.snapshot().transport,'disabled');
  stage='local-disposal';checks.push(await verifyLocalObservationDisposal(api,root));
  stage='onboarding';checks.push(...await verifyOnboarding(api,root));
  stage='maintenance';checks.push(...await verifyMaintenance(api,root,invoke));
  if(process.env.OVERWATCH_MEASURE_PERFORMANCE==='1'){stage='performance';checks.push(...await verifyPerformance(api,root));}
  await writeFile(resultPath,JSON.stringify({...base,finishedAt:new Date().toISOString(),passed:true,checks},null,2));
 }catch(error){
  if(error instanceof Error&&/^t(?:12|14|15)-[a-z-]+$/.test(error.message))stage=error.message;
  const failureLocation=error instanceof Error?error.stack?.match(/run\.cjs:\d+:\d+/)?.[0]:undefined;
  await writeFile(resultPath,JSON.stringify({...base,finishedAt:new Date().toISOString(),passed:false,checks,stage,failureLocation,localCoverage:api?.manager?.observationStatus(),localKinds:[...new Set(api?.manager?.observations.snapshot().records.map(r=>r.kind)??[])],failure:'extension-host-verification-failed'},null,2));
  throw new Error('extension-host-verification-failed');
 }finally{await api?.disable();}
}
