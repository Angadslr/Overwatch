import { build } from 'esbuild';
import { mkdir,writeFile,readFile,rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join,resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
const project=resolve('.'),root=join(project,'.local','t20-windows-'+randomUUID().slice(0,8)),fixture=join(root,'fixture with spaces');
await mkdir(fixture,{recursive:true});await writeFile(join(fixture,'.overwatch-probe-fixture'),'overwatch-invented-fixture-v1\n');await writeFile(join(fixture,'read.txt'),'Invented window ownership fixture.\n');
const entry=join(root,'ownership.cjs');await build({entryPoints:['tests/extension/ownership.ts'],outfile:entry,bundle:true,platform:'node',format:'cjs',target:'node22',external:['vscode']});
const binary=join(process.env.CURSOR_APP??'/Applications/Cursor.app','Contents','MacOS','Cursor');const children=[];
async function launch(phase,profile){
 const resultPath=join(root,phase+'-result.json');await rm(resultPath,{force:true});
 const child=spawn(binary,[`--user-data-dir=${join(root,profile)}`,`--extensions-dir=${join(root,'extensions')}`,`--extensionDevelopmentPath=${project}`,`--extensionTestsPath=${entry}`,'--skip-welcome','--skip-release-notes',fixture],{env:{...process.env,OVERWATCH_OWNERSHIP_PHASE:phase,OVERWATCH_OWNERSHIP_COORDINATION:root,OVERWATCH_EXTENSION_RESULT:resultPath},stdio:'ignore'});children.push(child);child.on('error',()=>{});
 return{child,resultPath};
}
async function waitFor(path,child){const deadline=Date.now()+90000;while(Date.now()<deadline){try{return JSON.parse(await readFile(path,'utf8'));}catch(error){if(error.code!=='ENOENT'&&!(error instanceof SyntaxError))throw error;}if(child.exitCode!==null&&child.exitCode!==0)throw new Error('ownership-editor-exited');await new Promise(resolve=>setTimeout(resolve,200));}throw new Error('ownership-editor-timeout');}
async function exited(child){const deadline=Date.now()+10000;while(child.exitCode===null&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,100));if(child.exitCode===null){child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve));}}
try{
 const owner=await launch('owner','primary');
 const readyDeadline=Date.now()+45000;while(Date.now()<readyDeadline){if(await readFile(join(root,'owner-ready'),'utf8').then(()=>true,()=>false))break;await new Promise(resolve=>setTimeout(resolve,200));}
 const passive=await launch('passive','secondary');const passiveResult=await waitFor(passive.resultPath,passive.child),ownerResult=await waitFor(owner.resultPath,owner.child);await exited(passive.child);await exited(owner.child);
 if(!passiveResult.passed||!ownerResult.passed)throw new Error('ownership-window-check-failed');
 const restart=await launch('restart','primary'),restartResult=await waitFor(restart.resultPath,restart.child);await exited(restart.child);
 const results={recordedAt:new Date().toISOString(),passed:restartResult.passed,nativeDelivery:false,fixture,results:[ownerResult,passiveResult,restartResult]};await writeFile(join(project,'docs/t20-window-verification.json'),JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify(results,null,2));if(!results.passed)process.exitCode=1;
}finally{for(const child of children)if(child.exitCode===null)child.kill('SIGTERM');}
