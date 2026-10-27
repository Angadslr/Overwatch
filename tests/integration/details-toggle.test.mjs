import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parse } from 'jsonc-parser';
const script=resolve('scripts/supervision-details.mjs');
async function setup(t){const root=await mkdtemp(join(tmpdir(),'details-toggle-'));t.after(()=>rm(root,{recursive:true,force:true}));return root;}
const run=(root,mode)=>spawnSync(process.execPath,[script,mode,'--workspace',root],{encoding:'utf8'});
test('terminal placement toggle preserves comments, trailing commas and unrelated settings',async t=>{
 const root=await setup(t);await mkdir(join(root,'.vscode'));const file=join(root,'.vscode/settings.json');await writeFile(file,'{\n  // Keep this comment\n  "files.autoSave": "off",\n}\n');
 assert.equal(run(root,'toggle').status,0);let text=await readFile(file,'utf8');assert.ok(text.includes('// Keep this comment'));assert.equal(parse(text)['files.autoSave'],'off');assert.equal(parse(text)['agentSupervision.detailsBeside'],false);
 assert.equal(run(root,'beside').status,0);assert.equal(parse(await readFile(file,'utf8'))['agentSupervision.detailsBeside'],true);
 assert.equal(run(root,'current').status,0);assert.equal(parse(await readFile(file,'utf8'))['agentSupervision.detailsBeside'],false);
 assert.deepEqual((await readdir(join(root,'.vscode'))).sort(),['settings.json']);
});
test('status is read-only and default beside; first write creates a valid setting',async t=>{
 const root=await setup(t);const status=run(root,'status');assert.equal(status.status,0);assert.ok(status.stdout.includes('beside'));assert.deepEqual(await readdir(root),[]);
 assert.equal(run(root,'toggle').status,0);assert.equal(parse(await readFile(join(root,'.vscode/settings.json'),'utf8'))['agentSupervision.detailsBeside'],false);
});
test('malformed, duplicate-key and wrong-typed settings remain byte-identical on failure',async t=>{
 const root=await setup(t);await mkdir(join(root,'.vscode'));const file=join(root,'.vscode/settings.json');
 for(const text of ['{broken','{"agentSupervision.detailsBeside":true,"agentSupervision.detailsBeside":false}','{"agentSupervision.detailsBeside":"false"}']){
  await writeFile(file,text);assert.notEqual(run(root,'toggle').status,0);assert.equal(await readFile(file,'utf8'),text);
 }
});
test('symlinked settings and competing lock are preserved without editing unrelated files',async t=>{
 const root=await setup(t);await mkdir(join(root,'.vscode'));const target=join(root,'outside.json'),file=join(root,'.vscode/settings.json');await writeFile(target,'{}');await symlink(target,file);
 assert.notEqual(run(root,'toggle').status,0);assert.equal(await readFile(target,'utf8'),'{}');await rm(file);await writeFile(file,'{}');
 await writeFile(join(root,'.vscode/.overwatch-details.lock'),'owned elsewhere');assert.notEqual(run(root,'toggle').status,0);assert.equal(await readFile(file,'utf8'),'{}');assert.equal(await readFile(join(root,'.vscode/.overwatch-details.lock'),'utf8'),'owned elsewhere');
});
