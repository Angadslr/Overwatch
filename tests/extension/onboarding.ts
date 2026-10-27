import * as vscode from 'vscode';
import assert from 'node:assert/strict';
import {readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import type {SupervisionApi} from '../../src/commands';
export async function verifyOnboarding(api:SupervisionApi,root:string):Promise<string[]>{
 assert.ok(api.manager);await api.disable();const path=join(root,'.cursor','hooks.json'),config=vscode.workspace.getConfiguration('agentSupervision');
 const original=JSON.stringify({version:1,unknown:{value:'FAKE_SECRET_BACKUP_ONLY'},hooks:{beforeReadFile:[{command:"printf '{\"permission\":\"allow\"}\\n'",timeout:1}],futureHook:{preserve:true}}},null,1)+'\n\n';
 await writeFile(path,original,{mode:0o600});
 try{
  assert.equal((await vscode.commands.executeCommand<{ok:boolean}>('overwatch.supervision.enable'))?.ok,false);assert.equal(await readFile(path,'utf8'),original);
  await config.update('allowExistingHooks',true,vscode.ConfigurationTarget.Workspace);
  assert.equal((await vscode.commands.executeCommand<{ok:boolean}>('overwatch.supervision.enable'))?.ok,true);
  const installed=JSON.parse(await readFile(path,'utf8'));assert.equal(installed.hooks.beforeReadFile.length,2);assert.deepEqual(installed.hooks.beforeReadFile[0],JSON.parse(original).hooks.beforeReadFile[0]);assert.deepEqual(installed.hooks.futureHook,{preserve:true});
  await vscode.commands.executeCommand('overwatch.supervision.report');const report=await readFile(join(root,'.local','supervision-storage','view-report.json'),'utf8');assert.equal(report.includes('FAKE_SECRET_BACKUP_ONLY'),false);
  await api.disable();assert.equal(await readFile(path,'utf8'),original);
  assert.equal((await vscode.commands.executeCommand<{ok:boolean}>('overwatch.supervision.enable'))?.ok,true);await api.disable();assert.equal(await readFile(path,'utf8'),original);
  return ['existing project hooks refuse by default; explicit opt-in preserves unknown keys and permission entries, keeps backup contents out of diagnostics, and restores original bytes across repeated enable/disable'];
 }finally{await api.disable();await config.update('allowExistingHooks',false,vscode.ConfigurationTarget.Workspace);if(await readFile(path,'utf8').then(bytes=>bytes===original,()=>false))await rm(path);}
}
