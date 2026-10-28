import * as vscode from 'vscode';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, writeFile, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import type { SupervisionApi } from '../../src/commands';
import { conversationKey } from '../../src/core/identity';

async function waitFor(predicate:()=>boolean,stage:string):Promise<void>{
 const end=Date.now()+10000;while(!predicate()&&Date.now()<end)await new Promise(resolve=>setTimeout(resolve,25));if(!predicate())throw new Error('t15-'+stage);
}
export async function verifyActivity(api:SupervisionApi,root:string,extensionPath:string,invoke:(hook:string,path:string,extra?:Record<string,unknown>)=>Promise<void>):Promise<string[]>{
 assert.ok(api.manager&&api.tree&&api.files&&api.activityTree);const checks:string[]=[];let stage='initial';
 try {
 assert.equal(vscode.workspace.getConfiguration('agentSupervision').get('followLatest'),false);
 const before=api.display.entries().length;
 const activityRoots=api.activityTree.getChildren();
 if(before>100){
  assert.ok(activityRoots.every(node=>node.kind==='activity-page'));
  const paged=activityRoots.flatMap(node=>api.activityTree!.getChildren(node));
  assert.equal(paged.length,before);assert.ok(activityRoots.every(node=>api.activityTree!.getChildren(node).length<=100));
  assert.deepEqual(paged.map(node=>node.id),api.display.entries().map(entry=>entry.key));
  const latest=api.activityTree.latestNode();assert.equal(latest?.id,api.display.entries().at(-1)?.key);assert.ok(latest&&api.activityTree.getParent(latest));
 }
 checks.push('large Activity history has bounded expandable pages, exact chronology and a reachable latest event without dropping retained evidence');
 const read=api.display.entries().find(e=>e.label==='read.txt'&&e.event.phase==='completed');assert.ok(read);
 stage='inspect';
 const inspect=()=>vscode.commands.executeCommand<{ok:boolean;availability:string}>('overwatch.supervision.inspectActivity',read.key);
 assert.equal((await inspect())?.ok,true);
 const details=api.details.snapshot();assert.ok(details.column&&details.column>1);
 for(const field of ['Source:','Operation ID:','Source call ID:','Received at:','Workspace:','Worktree: unknown','Activity evidence:','Attribution evidence:','Disk persistence evidence:','Model use: unknown','Human acceptance: unknown','Child-to-file ownership: unverified'])assert.ok(details.text.includes(field));
 assert.equal(details.text.includes('FAKE_SECRET_MARKER'),false);assert.equal(vscode.window.activeTextEditor?.document.uri.fsPath,join(root,'read.txt'));
 checks.push('activity selection opens metadata details beside the source editor with independent evidence, identities, timestamps, file scope and explicit unknowns');
 stage='filters';
 const selected=conversationKey(read.event,read.event.conversationId!);
 assert.equal((await vscode.commands.executeCommand<{ok:boolean}>('overwatch.supervision.setActivityFilters',{conversation:selected,operation:'read',withinMs:900000,evidence:'source-reported'}))?.ok,true);
 const matching=api.display.entries();assert.ok(matching.length>0&&matching.length<before);
 assert.ok(matching.every(e=>e.event.operation==='read'&&e.event.conversationId===read.event.conversationId));
 const operations=api.tree.getChildren().flatMap(n=>api.tree!.getChildren(n)).filter(n=>n.operation);
 assert.equal(api.files.rows().reduce((sum,row)=>sum+row.children.filter(n=>n.operation).length,0),operations.length);
 assert.ok(operations.every(n=>n.operation!.eventIds.some(id=>matching.some(e=>e.event.eventId===id))));
 assert.equal(api.activityTree.getChildren().filter(n=>n.kind==='activity').length,matching.length);
 await vscode.commands.executeCommand('overwatch.supervision.clearActivityFilters');assert.equal(api.display.entries().length,before);
 assert.equal((await vscode.commands.executeCommand<{ok:boolean}>('overwatch.supervision.setActivityFilters',{operation:'sudo'}))?.ok,false);
 checks.push('conversation, operation, time and evidence filters use identical matching events across Activity, Conversations and Files; clear restores retained rows');
 stage='freeze';
 const editor=vscode.window.activeTextEditor?.document.uri.toString();
 await vscode.commands.executeCommand('overwatch.supervision.freezeDisplay');assert.equal(api.display.frozen,true);
 const held=JSON.stringify(api.activityTree.getChildren()),heldFiles=JSON.stringify(api.files.getChildren());
 const received=api.manager.evidence.size;
 await invoke('afterFileEdit','edit.txt',{conversation_id:'t15-frozen-new-session'});
 await waitFor(()=>api.manager!.evidence.size>received&&api.display.pending>0,'frozen-delivery');
 assert.equal(JSON.stringify(api.activityTree.getChildren()),held);assert.equal(JSON.stringify(api.files.getChildren()),heldFiles);
 assert.ok(api.display.status().includes('collection continues'));assert.equal(vscode.window.activeTextEditor?.document.uri.toString(),editor);
 await vscode.commands.executeCommand('overwatch.supervision.freezeDisplay');assert.equal(api.display.frozen,false);assert.ok(api.display.entries().length>before);assert.ok(api.display.resumed>0);
 checks.push('freeze holds tree/list rows and ages while collection continues; incoming count advances and resume shows arrivals without moving editor focus');
 stage='terminal-toggle';
 const node=process.env.OVERWATCH_TEST_NODE;assert.ok(node);
 await new Promise<void>((resolve,reject)=>{
  const child=spawn(node,[join(extensionPath,'scripts/supervision-details.mjs'),'current','--workspace',root],{stdio:['ignore','pipe','pipe']});let out='',err='';
  const timeout=setTimeout(()=>{child.kill();reject(new Error('terminal-toggle-timeout'));},5000);child.on('error',reject);child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);
  child.on('close',code=>{clearTimeout(timeout);try{assert.equal(code,0);assert.equal(err,'');assert.ok(out.includes('current editor group'));resolve();}catch(e){reject(e);}});
 });
 await waitFor(()=>vscode.workspace.getConfiguration('agentSupervision').get('detailsBeside')===false,'terminal-setting');
 await inspect();assert.equal(api.details.snapshot().column,1);
 const toggled=await vscode.commands.executeCommand<{ok:boolean;enabled:boolean}>('overwatch.supervision.toggleDetailsBeside');assert.equal(toggled?.enabled,true);
 await inspect();assert.ok(api.details.snapshot().column!>1);
  assert.equal(vscode.window.tabGroups.all.flatMap(g=>g.tabs).filter(t=>t.input instanceof vscode.TabInputText&&t.input.uri.toString()===api.details.uri.toString()).length,1);
 checks.push('terminal setting change switches details into the source editor group; Command Palette toggle restores beside placement without extra accumulating groups');
 stage='missing';
 const missing=api.display.entries().find(e=>e.label==='missing.txt');assert.ok(missing);
 assert.equal((await vscode.commands.executeCommand<{availability:string}>('overwatch.supervision.inspectActivity',missing.key))?.availability,'missing');
 await assert.rejects(access(join(root,'missing.txt')));
 const contents=await readFile(join(root,'read.txt'));await rm(join(root,'read.txt'));
 try {assert.equal((await inspect())?.availability,'missing');assert.ok(api.details.snapshot().text.includes('Observation phase: "completed"'));await assert.rejects(access(join(root,'read.txt')));}
 finally {await writeFile(join(root,'read.txt'),contents);}
 checks.push('missing/deleted current files open historical details without recreation or changes to completed source evidence');
 await vscode.commands.executeCommand('overwatch.supervision.freezeDisplay');
 return checks;
 }catch{throw new Error('t15-'+stage);}
}
