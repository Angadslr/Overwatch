import * as vscode from 'vscode';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import type{PluginManager}from'../integration/pluginManager';
import {HistoryReset,type ResetReview}from'../privacy/historyReset';
import {ReviewedExports,type ExportPreview}from'../privacy/localExport';
class ReviewDocument implements vscode.Disposable{
 private text='No active review.\n';private readonly changed=new vscode.EventEmitter<vscode.Uri>();private readonly uri:vscode.Uri;private readonly registration:vscode.Disposable;
 private revision=0;
 constructor(scheme:string,name:string){this.uri=vscode.Uri.from({scheme,authority:randomUUID(),path:'/'+name});this.registration=vscode.workspace.registerTextDocumentContentProvider(scheme,{onDidChange:this.changed.event,provideTextDocumentContent:()=>this.text});}
 async show(text:string):Promise<void>{const revision=++this.revision;this.text=text;this.changed.fire(this.uri);const document=await vscode.workspace.openTextDocument(this.uri);if(this.revision!==revision){this.changed.fire(this.uri);return;}await vscode.window.showTextDocument(document,{viewColumn:vscode.ViewColumn.Beside,preview:true});if(this.revision!==revision)this.changed.fire(this.uri);}
 clear():void{this.revision++;this.text='Review unavailable. Prepare a new review before saving or clearing.\n';this.changed.fire(this.uri);}
 dispose():void{this.clear();this.registration.dispose();this.changed.dispose();}
}
export interface MaintenanceApi{
 prepareExport:(relativePaths?:boolean)=>Promise<ExportPreview>;saveExport:(token:string)=>Promise<string>;invalidateExport:()=>void;
 prepareReset:(includeExports?:boolean)=>Promise<ResetReview>;commitReset:(token:string)=>Promise<{removed:number;newEpoch:string}>;cancelReset:()=>Promise<void>;
}
export function registerMaintenance(context:vscode.ExtensionContext,root:string|undefined,manager:PluginManager|undefined,callbacks:{disable:()=>Promise<void>;afterReset:()=>Promise<void>;workspaceReady:()=>Promise<boolean>}):MaintenanceApi{
 const exportDocument=new ReviewDocument('overwatch-supervision-export','Diagnostics preview.json'),resetDocument=new ReviewDocument('overwatch-supervision-reset','History reset review.json');
 const storage=root?join(root,'.local','supervision-storage'):undefined,exports=storage?new ReviewedExports(storage):undefined,resets=root&&storage?new HistoryReset(root,storage):undefined;let lastReset:ResetReview|undefined;
 const ready=async()=>{if(!manager||!root||!exports||!resets||!manager.readiness().supported||!await callbacks.workspaceReady())throw new Error('maintenance-unavailable');return{manager,root,exports,resets};};
 const api:MaintenanceApi={
  prepareExport:async(relativePaths=false)=>{const {manager,exports}=await ready();return manager.withStorageLease(async()=>exports.prepare({source:[...manager.evidence.values()].map(o=>o.event),local:manager.observations.snapshot().records.map(o=>o.event),health:manager.health.snapshot(),readiness:manager.readiness(),exclusions:manager.exclusions,editorApiVersion:vscode.version},manager.exportEpoch,relativePaths));},
  saveExport:async token=>{const {manager,exports}=await ready();return manager.withStorageLease(guard=>exports.save(token,()=>manager.exportEpoch,guard));},
  invalidateExport:()=>{exports?.invalidate();exportDocument.clear();},
  prepareReset:async(includeExports=false)=>{const {resets}=await ready();await api.cancelReset();api.invalidateExport();await callbacks.disable();lastReset=await resets.prepare(includeExports);return{...lastReset};},
  commitReset:async token=>{const {manager,resets}=await ready();try{const result=await resets.commit(token);lastReset=undefined;resetDocument.clear();api.invalidateExport();manager.clearHistoryProjection();await callbacks.afterReset();return result;}catch(error){lastReset=undefined;resetDocument.clear();api.invalidateExport();throw error;}},
  cancelReset:async()=>{lastReset=undefined;await resets?.cancel();resetDocument.clear();},
 };
 const run=(action:()=>Promise<unknown>)=>async()=>{try{return await action();}catch{void vscode.window.showWarningMessage('Agent Supervision maintenance did not complete. Existing user data and foreign hooks are preserved; inspect ownership or prepare a fresh review.');return{ok:false};}};
 context.subscriptions.push(exportDocument,resetDocument,{dispose:()=>{api.invalidateExport();void api.cancelReset().catch(()=>{});}},
  vscode.commands.registerCommand('overwatch.supervision.previewExport',run(async()=>{
   const choice=await vscode.window.showQuickPick([{label:'Redact paths',description:'Default; pseudonymized identities and no file locators',paths:false},{label:'Include normalized relative paths',description:'Local export only; no absolute paths, native path hashes or file keys',paths:true}],{title:'Preview local diagnostic export'});if(!choice)return{ok:false,reason:'cancelled'};const preview=await api.prepareExport(choice.paths);await exportDocument.show(preview.text);void vscode.window.showInformationMessage('Review the included categories and data. Run “Agent Supervision: Save Reviewed Local Export” to save these exact bytes.');return{ok:true,sha256:preview.sha256};
  })),
  vscode.commands.registerCommand('overwatch.supervision.saveReviewedExport',run(async()=>{
   const reviewed=exports as ReviewedExports|undefined;if(!reviewed)throw new Error('maintenance-unavailable');
   const token=reviewed.currentToken();if(!token)throw new Error('export-review-stale');
   const file=await api.saveExport(token);await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(file)),{preview:true});return{ok:true};
  })),
  vscode.commands.registerCommand('overwatch.supervision.previewHistoryReset',run(async()=>{
   const choice=await vscode.window.showQuickPick([{label:'Keep saved exports',description:'Clear owned history, pending telemetry and staging; keep saved diagnostic exports',exports:false},{label:'Also clear saved local exports',description:'Includes generated exports under this workspace’s private supervision storage',exports:true}],{title:'Choose the owned data scope to review'});if(!choice)return{ok:false,reason:'cancelled'};const review=await api.prepareReset(choice.exports);await resetDocument.show(JSON.stringify({workspace:root,...review},null,2)+'\n');void vscode.window.showInformationMessage('Collection is off. Review the selected scope, then run “Agent Supervision: Clear Reviewed Owned History” or cancel the review.');return{ok:true};
  })),
  vscode.commands.registerCommand('overwatch.supervision.clearReviewedHistory',run(async()=>{
   if(!lastReset)throw new Error('reset-review-expired');const review=lastReset;
   const confirmed=await vscode.window.showWarningMessage('Permanently clear the reviewed Agent Supervision data?',{modal:true,detail:`Workspace: ${root}\n${review.files} reviewed artifacts (${review.bytes} bytes). ${review.includeExports?'Saved local exports are included.':'Saved exports are retained.'}\nUser files, foreign hooks, original-hook backups and native conversations are outside this scope.`},'Clear Reviewed History');
   if(confirmed!=='Clear Reviewed History'){await api.cancelReset();return{ok:false,reason:'cancelled'};}const result=await api.commitReset(review.token);void vscode.window.showInformationMessage(`Cleared ${result.removed} owned artifacts. Collection remains off; enable explicitly to start a new generation.`);return{ok:true};
  })),
  vscode.commands.registerCommand('overwatch.supervision.cancelMaintenanceReview',run(async()=>{api.invalidateExport();await api.cancelReset();return{ok:true};})),
 );return api;
}
