import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root=fileURLToPath(new URL('../',import.meta.url));
const local=join(root,'.local/go-toolchain/go/bin/go');
const executable=existsSync(local)?local:'go';
mkdirSync(join(root,'dist'),{recursive:true});
mkdirSync(join(root,'.local/go-cache'),{recursive:true});
const mode=process.argv[2];
if (mode!=='build' && mode!=='test') throw new Error('Expected build or test.');
const args=mode==='build'?['build','-trimpath','-buildvcs=false','-o','../dist/cursor-supervision-hook','./cmd/cursor-supervision-hook']:['test','./...'];
const result=spawnSync(executable,args,{cwd:join(root,'helper'),stdio:'inherit',env:{...process.env,GOTOOLCHAIN:'local',GOCACHE:process.env.GOCACHE??join(root,'.local/go-cache')}});
if(result.error) console.error('Go 1.26+ is required; see docs/helper-pipeline.md.');
process.exitCode=result.status??1;
