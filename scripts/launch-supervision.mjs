import {mkdir,writeFile,access} from 'node:fs/promises';
import {constants} from 'node:fs';
import {spawn} from 'node:child_process';
import {join,resolve} from 'node:path';

const project=resolve('.'),fixture=join(project,'.local','t08-native fixture with spaces');
await mkdir(fixture,{recursive:true});await writeFile(join(fixture,'.overwatch-probe-fixture'),'overwatch-invented-fixture-v1\n');
for(const[name,contents]of Object.entries({'read.txt':'Invented T08 read fixture: amber.\n','edit.txt':'Invented T08 edit fixture: cobalt.\n','shared.txt':'Invented T08 shared fixture: indigo.\n'}))try{await writeFile(join(fixture,name),contents,{flag:'wx'});}catch(error){if(error.code!=='EEXIST')throw error;}
const cli=join(process.env.CURSOR_APP??'/Applications/Cursor.app','Contents','Resources','app','bin','cursor');await access(cli,constants.X_OK);
const child=spawn(cli,['--new-window',`--extensionDevelopmentPath=${project}`,fixture],{env:{...process.env,OVERWATCH_PROBE_AUTOSTART:'0'},stdio:'inherit'});
child.on('error',()=>{console.error('Cursor fixture launch failed.');process.exitCode=1;});child.on('exit',code=>{process.exitCode=code??1;});
console.log('Open Agent Supervision and run Enable in Fixture Workspace. This opens only the invented T08 fixture.');
