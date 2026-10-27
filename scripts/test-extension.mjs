import {build} from 'esbuild';
import {mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {resolve,join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';

const suffix=process.env.OVERWATCH_EXTENSION_RUN??'default';
if(!/^[a-z0-9-]{1,32}$/.test(suffix))throw new Error('invalid-test-run-name');
const project=resolve('.'),testRoot=join(project,'.local','t08-extension-tests-'+suffix);
// Test extension hosts may reset mementos; each invocation owns fresh storage.
const profile=join(project,'.local','eh-'+createHash('sha256').update(suffix).digest('hex').slice(0,8));
const fixture=join(testRoot,'fixture with spaces-'+randomUUID());
await mkdir(testRoot,{recursive:true});await mkdir(fixture,{recursive:true});
await writeFile(join(fixture,'.overwatch-probe-fixture'),'overwatch-invented-fixture-v1\n');
await mkdir(join(fixture,'.vscode'),{recursive:true});
await writeFile(join(fixture,'.vscode','settings.json'),JSON.stringify({'files.autoSave':'off'}));
for(const [name,value]of Object.entries({'read.txt':'Invented extension read fixture: amber.\n','edit.txt':'Invented extension edit fixture: cobalt.\n'}))try{await writeFile(join(fixture,name),value,{flag:'wx'});}catch(error){if(error.code!=='EEXIST')throw error;}
const resultPath=join(testRoot,'result.json');await rm(resultPath,{force:true});
await build({entryPoints:['tests/extension/run.ts'],outfile:join(testRoot,'run.cjs'),bundle:true,platform:'node',format:'cjs',target:'node22',external:['vscode']});
const binary=join(process.env.CURSOR_APP??'/Applications/Cursor.app','Contents','MacOS','Cursor');
const child=spawn(binary,[`--user-data-dir=${profile}`,`--extensions-dir=${join(testRoot,'extensions')}`,`--extensionDevelopmentPath=${project}`,`--extensionTestsPath=${join(testRoot,'run.cjs')}`,'--skip-welcome','--skip-release-notes',fixture],{env:{...process.env,OVERWATCH_EXTENSION_RESULT:resultPath,OVERWATCH_TEST_NODE:process.execPath,OVERWATCH_PROBE_AUTOSTART:'0'},stdio:process.env.OVERWATCH_EXTENSION_DEBUG==='1'?'inherit':'ignore'});
let launchFailed=false;
child.on('error',()=>{launchFailed=true;process.exitCode=1;});
await writeFile(join(testRoot,'launcher.json'),JSON.stringify({pid:child.pid??null,profile:profile}));
console.log('Starting the installed Cursor extension host in an isolated test profile. Trust only the named invented fixture if Cursor asks.');
const deadline=Date.now()+180000;let result;
while(Date.now()<deadline){
 try{result=JSON.parse(await readFile(resultPath,'utf8'));break;}catch(error){if(error.code!=='ENOENT'&&!(error instanceof SyntaxError))throw error;}
 if(launchFailed||child.exitCode!==null)break;
 await new Promise(resolve=>setTimeout(resolve,250));
}
if(!result){child.kill('SIGTERM');console.error(launchFailed?'Extension host could not launch.':child.exitCode!==null?'Extension host exited without a verification result.':'Extension host did not produce a result within its test budget.');process.exitCode=1;}
else{
 console.log(JSON.stringify(result,null,2));process.exitCode=result.passed?0:1;
 const exitDeadline=Date.now()+10000;
 while(child.exitCode===null&&Date.now()<exitDeadline)await new Promise(resolve=>setTimeout(resolve,100));
 if(child.exitCode===null)child.kill('SIGTERM');
}
