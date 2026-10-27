import * as vscode from 'vscode';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFile, writeFile, access } from 'node:fs/promises';
import type { SupervisionApi } from '../../src/commands';

export async function verifyViews(api: SupervisionApi, root: string, invoke: (hook: string, path: string, extra?: Record<string, unknown>) => Promise<void>): Promise<string[]> {
 assert.ok(api.tree && api.files && api.decorations && api.manager);
 const checks: string[] = [];
 let stage="volume";
 try {
 const editor = vscode.window.activeTextEditor?.document.uri.toString();
 for(let start=0;start<200;start+=20) await Promise.all(Array.from({length:20},(_,offset)=>{const i=start+offset;return invoke('afterFileEdit','edit.txt',{conversation_id:'t14-volume-'+i,tool_use_id:'volume-'+i});}));
 const deadline=Date.now()+15000;
 while(api.files.rows().filter(r=>r.relativePath==='edit.txt'&&r.identity==='source path hint').reduce((n,r)=>n+r.sessions.length,0)<201&&Date.now()<deadline)
  await new Promise(resolve=>setTimeout(resolve,50));
 stage="counts";
 const conversationRows=api.tree.getChildren().flatMap(n=>api.tree!.getChildren(n)).filter(n=>n.kind==='file'&&n.hint);
 const fileRows=api.files.rows().filter(r=>r.identity==='source path hint');
 assert.equal(fileRows.reduce((n,r)=>n+r.children.length,0),conversationRows.length);
 stage="sessions";
 assert.ok(fileRows.some(r=>r.relativePath==='edit.txt'&&r.sessions.length===201));
 stage="scope";
 assert.ok(api.files.getChildren().every(n=>n.label.includes('Worktree unspecified')));
 stage="tooltip";
 assert.ok(api.files.getChildren().flatMap(n=>api.files!.getChildren(n)).every(n=>String(api.files!.getTreeItem(n).tooltip).includes('Identity evidence:')));
 checks.push('200-session volume has identical source operation counts in Conversations and Files with explicit worktree and identity labels');
 stage="badges";
 const events:string[][]=[];const subscription=api.decorations.onDidChangeFileDecorations(uris=>events.push(uris.map(u=>u.toString())));
 try {
  const badgeDeadline=Date.now()+5000;
  while(!/20[01] recent source sessions/.test(api.decorations.provideFileDecoration(vscode.Uri.file(join(root,'edit.txt')))?.tooltip??'')&&Date.now()<badgeDeadline)await new Promise(resolve=>setTimeout(resolve,50));
  const badge=api.decorations.provideFileDecoration(vscode.Uri.file(join(root,'edit.txt')));assert.equal(badge?.badge,'W');assert.ok(/20[01] recent source sessions/.test(badge.tooltip??''));
  await api.decorations.refresh();const count=events.length;await api.decorations.refresh();assert.equal(events.length,count);
  assert.ok(events.every(uris=>uris.every(uri=>uri.startsWith(vscode.Uri.file(root).toString()+'/'))));
  stage="focus";
  assert.equal(vscode.window.activeTextEditor?.document.uri.toString(),editor);
  checks.push('Explorer edit badge uses text and theme colors, emits only affected URIs and preserves editor focus');
  stage="expiry";
  await new Promise(resolve=>setTimeout(resolve,31000));
  await api.decorations.refresh();
  assert.equal(api.decorations.provideFileDecoration(vscode.Uri.file(join(root,'edit.txt'))),undefined);
  assert.ok(api.manager.store.snapshot().operations.some(o=>o.state==='completed'));
  checks.push('stale badges clear while completed source history remains terminal');
 } finally {subscription.dispose();}
 stage="manual";
 if(process.env.OVERWATCH_EXTENSION_MANUAL==='1') {
  await invoke('afterFileEdit','edit.txt',{conversation_id:'t14-volume-0'});
  await api.decorations.refresh();
  await vscode.workspace.getConfiguration('workbench').update('colorTheme','Default High Contrast',vscode.ConfigurationTarget.Global);
  await vscode.commands.executeCommand('overwatch.supervision.byFile.focus');
  await writeFile(join(root,'..','manual-ready.json'),JSON.stringify({root,sourceOperations:conversationRows.length,sourceSessions:api.manager.identities.snapshot().sessions.length,theme:vscode.workspace.getConfiguration('workbench').get('colorTheme')}));
  const manualDeadline=Date.now()+180000;let reviewed=false;
  while(Date.now()<manualDeadline){try{await access(join(root,'..','manual-reviewed'));reviewed=true;break;}catch{await new Promise(resolve=>setTimeout(resolve,250));}}
  assert.equal(reviewed,true);checks.push('manual Cursor keyboard and high-contrast review completed at 200-session volume');
 }
 return checks;
 } catch {throw new Error("t14-"+stage);}
}

export async function verifyPrivacy(api:SupervisionApi,root:string,invoke:(hook:string,path:string,extra?:Record<string,unknown>)=>Promise<void>):Promise<string[]> {
 assert.ok(api.manager&&api.tree&&api.files);
 const config=vscode.workspace.getConfiguration('agentSupervision');
 await config.update('pathExclusions',['edit.txt'],vscode.ConfigurationTarget.Workspace);
 const deadline=Date.now()+5000;
 while(!api.manager.status.includes('privacy changed')&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,50));
 assert.equal(api.manager.enabled,false);assert.ok(api.manager.status.includes('privacy changed'));
 assert.equal((await vscode.commands.executeCommand<{ok:boolean}>('overwatch.supervision.enable'))?.ok,true);
 assert.equal(api.files.rows().some(r=>r.relativePath==='edit.txt'),false);
 await invoke('afterFileEdit','edit.txt',{exception:{stack:'FAKE_SECRET_EXCEPTION'},arbitrary:'FAKE_SECRET_UNKNOWN'});
 const receiptDeadline=Date.now()+5000;
 while(api.manager.health.snapshot().privacy.excluded<1&&Date.now()<receiptDeadline)await new Promise(resolve=>setTimeout(resolve,50));
 assert.ok(api.manager.health.snapshot().privacy.excluded>0);
 assert.equal(api.files.rows().some(r=>r.relativePath==='edit.txt'),false);
 await vscode.commands.executeCommand('overwatch.supervision.report');
 const report=await readFile(join(root,'.local','supervision-storage','view-report.json'),'utf8');
 assert.equal(report.includes('edit.txt'),false);assert.equal(report.includes('FAKE_SECRET'),false);assert.equal(report.includes('relativePath'),false);assert.equal(report.includes('fileKey'),false);
 await api.disable();
 await config.update('pathExclusions',[],vscode.ConfigurationTarget.Workspace);
 return ['workspace exclusion stops collection, filters replay and helper publication, and default diagnostics omit all file locators'];
}
