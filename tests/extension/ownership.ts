import * as vscode from 'vscode';
import assert from 'node:assert/strict';
import { readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import type { SupervisionApi } from '../../src/commands';
async function until(path:string):Promise<void>{const deadline=Date.now()+60000;while(Date.now()<deadline){if(await access(path).then(()=>true,()=>false))return;await new Promise(resolve=>setTimeout(resolve,100));}throw new Error('ownership-coordination-timeout');}
export async function run():Promise<void>{
 const phase=process.env.OVERWATCH_OWNERSHIP_PHASE!,coordination=process.env.OVERWATCH_OWNERSHIP_COORDINATION!,result=process.env.OVERWATCH_EXTENSION_RESULT!;
 const checks:string[]=[];let api:SupervisionApi|undefined;let stage='activation';
 try{
  const extension=vscode.extensions.getExtension<SupervisionApi>('angad-local.overwatch-native-probe');assert.ok(extension);api=await extension.activate();
  stage='trust';assert.equal(vscode.workspace.isTrusted,true);const root=vscode.workspace.workspaceFolders![0]!.uri.fsPath,storage=join(root,'.local','supervision-storage');stage=phase;
  if(phase==='owner'){
   assert.equal((await vscode.commands.executeCommand<{ok:boolean}>('overwatch.supervision.enable'))?.ok,true);
   await writeFile(join(coordination,'owner-ready'),'ready');await until(join(coordination,'passive-finished'));
   assert.equal(api.manager?.enabled,true);assert.equal(api.manager?.readiness().ownership,'owned');checks.push('primary Cursor window keeps its single collector while another window enables and closes');
   // Preserve the user's request exactly as host deactivation does before restart.
   await api.manager?.disable();
  }else if(phase==='passive'){
   await until(join(coordination,'owner-ready'));const before=await readFile(join(storage,'publisher.json'),'utf8'),hooks=await readFile(join(root,'.cursor','hooks.json'),'utf8');
   const attempt=await vscode.commands.executeCommand<{ok:boolean;reason:string}>('overwatch.supervision.enable');assert.equal(attempt?.ok,false);assert.equal(attempt?.reason,'other-window-owner');assert.equal(api.manager?.readiness().ownership,'other-window');
   await api.disable();assert.equal(await readFile(join(storage,'publisher.json'),'utf8'),before);assert.equal(await readFile(join(root,'.cursor','hooks.json'),'utf8'),hooks);checks.push('second installed Cursor window is diagnosed as passive and cannot stop or duplicate the owning pipeline');await writeFile(join(coordination,'passive-finished'),'finished');
  }else{
   assert.equal(phase,'restart');
   // Installed extension-test mode resets mementos; persistent-choice reload is a separate normal-window check.
   assert.equal((await vscode.commands.executeCommand<{ok:boolean}>('overwatch.supervision.enable'))?.ok,true);
   assert.equal(api.manager?.enabled,true);assert.equal(api.manager?.readiness().ownership,'owned');assert.equal(api.manager?.health.snapshot().nativeDelivery,'awaiting-first-event');checks.push('same Cursor test profile re-enables after host restart; test-mode mementos reset, so persistent-choice resume requires the separate normal-window check');await api.disable();
  }
  await writeFile(result,JSON.stringify({phase,passed:true,nativeDelivery:false,editorApiVersion:vscode.version,node:process.versions.node,checks},null,2));
 }catch{await writeFile(result,JSON.stringify({phase,passed:false,nativeDelivery:false,checks,stage,enabled:api?.manager?.enabled,status:api?.manager?.status,ownership:api?.manager?.readiness().ownership,failure:'ownership-host-verification-failed'},null,2));throw new Error('ownership-host-verification-failed');}
 finally{await api?.manager?.disable();}
}
