import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, writeFile, readFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { inspectWorkspaceLease } from '../../src/integration/workspaceLease';
async function setup(t:{after:(fn:()=>Promise<void>)=>void}){const root=await realpath(await mkdtemp(join(tmpdir(),'overwatch-lease-')));t.after(()=>rm(root,{recursive:true,force:true}));return root;}
test('lease inspection distinguishes no owner, a live owner and a proven dead process without changing bytes',async t=>{
 const root=await setup(t),path=join(root,'collector.lock');assert.deepEqual(await inspectWorkspaceLease(root),{state:'unowned'});
 const live=JSON.stringify({leaseVersion:1,pid:process.pid,token:randomUUID()});await writeFile(path,live,{mode:0o600});assert.deepEqual(await inspectWorkspaceLease(root),{state:'other-window'});assert.equal(await readFile(path,'utf8'),live);
 const token=randomUUID();await writeFile(path,JSON.stringify({leaseVersion:1,pid:2147483647,token}));assert.deepEqual(await inspectWorkspaceLease(root),{state:'recoverable',token});
});
test('malformed, public and symlink leases remain uncertain and intact',async t=>{
 const root=await setup(t),path=join(root,'collector.lock');for(const bytes of ['{}','BROKEN',JSON.stringify({leaseVersion:1,pid:0,token:randomUUID()})]){await writeFile(path,bytes,{mode:0o600});assert.deepEqual(await inspectWorkspaceLease(root),{state:'uncertain'});assert.equal(await readFile(path,'utf8'),bytes);}
 await rm(path);const foreign=join(root,'foreign');await writeFile(foreign,'foreign',{mode:0o600});await symlink(foreign,path);assert.deepEqual(await inspectWorkspaceLease(root),{state:'uncertain'});assert.equal(await readFile(foreign,'utf8'),'foreign');
 await rm(path);await writeFile(path,JSON.stringify({leaseVersion:1,pid:2147483647,token:randomUUID()}),{mode:0o644});assert.deepEqual(await inspectWorkspaceLease(root),{state:'uncertain'});
});
