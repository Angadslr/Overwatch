import{test}from'node:test';
import assert from'node:assert/strict';
import{mkdtemp,realpath,rm,readFile,access,readdir,stat,symlink}from'node:fs/promises';
import{join}from'node:path';
import{tmpdir}from'node:os';
import{randomUUID}from'node:crypto';
import{buildLocalExport,ReviewedExports,type ExportInput}from'../../src/privacy/localExport';
import{CollectorHealth}from'../../src/core/health';
import type{EventV1}from'../../src/core/contracts';
const event=():EventV1=>({schemaVersion:1,eventId:randomUUID(),collectorId:'FAKE_SECRET_COLLECTOR',environmentId:'local',workspaceId:'workspace',source:'cursor-hook',sourceEvent:'beforeReadFile',receivedAt:new Date().toISOString(),actorScope:'unknown',operationId:'FAKE_SECRET_OPERATION',operation:'read',phase:'requested',outcome:'unknown',targets:[{relativePath:'src/visible.ts',fileKey:'FAKE_SECRET_FILE_KEY',pathScope:'workspace',pathKind:'file'}],evidence:{activity:'source-reported',attribution:'unknown',completion:'not-observed',diskPersistence:'unknown',correlation:'unpaired',limitations:['source-coverage-partial']}});
const input=():ExportInput=>{const health=new CollectorHealth();health.beginCollection();const h=health.snapshot();return{source:[event()],local:[],health:{...h,status:'FAKE_SECRET_EXCEPTION'},readiness:{registered:true,owner:true,supported:true,health:h,check:{state:'not-run'},counters:{accepted:1,rejected:0,failures:0},recoveredTail:false},exclusions:[],editorApiVersion:'1.128.0'};};
async function setup(t:{after:(fn:()=>Promise<void>)=>void}){const root=await realpath(await mkdtemp(join(tmpdir(),'local-export-')));t.after(()=>rm(root,{recursive:true,force:true}));return{root,exports:new ReviewedExports(root)};}
test('default export is content-free, drops arbitrary fields, pseudonymizes identities and omits path locators',()=>{
 const value=input();value.source=[...value.source,{...event(),tool_output:'FAKE_SECRET_TOOL_OUTPUT'} as EventV1];const report=buildLocalExport(value) as any,text=JSON.stringify(report);assert.equal(text.includes('FAKE_SECRET'),false);assert.equal(text.includes('src/visible.ts'),false);assert.equal(text.includes('fileKey'),false);assert.equal(report.source.invalid,1);assert.equal(report.source.events[0].actorScope,'unknown');assert.equal(report.manifest.relativePaths,false);
});
test('optional relative paths and exclusions are explicit and bounded; unsupported free-text source names are not copied',()=>{
 const value=input();const visible=buildLocalExport(value,true) as any;assert.equal(visible.source.events[0].targets[0].relativePath,'src/visible.ts');value.source=[...value.source,{...event(),sourceEvent:'FAKE_SECRET_UNKNOWN_EVENT'} as unknown as EventV1];assert.equal((buildLocalExport(value) as any).source.invalid,1);value.exclusions=['src/**'];const excluded=buildLocalExport(value,true) as any;assert.equal(excluded.source.included,0);assert.equal(excluded.source.excluded,1);assert.equal(JSON.stringify(excluded).includes('src/visible.ts'),false);
 value.exclusions=[];value.source=Array.from({length:2010},()=>event());const limited=buildLocalExport(value) as any;assert.equal(limited.source.included,2000);assert.equal(limited.source.outsideWindow,10);
});
test('saving writes exactly the reviewed bytes privately; replaying a consumed review is refused',async t=>{
 const {root,exports}=await setup(t),preview=exports.prepare(input(),'epoch');const file=await exports.save(preview.token,()=> 'epoch',async()=>{});assert.equal(await readFile(file,'utf8'),preview.text);assert.equal((await stat(file)).mode&0o777,0o600);assert.equal((await stat(join(root,'exports'))).mode&0o777,0o700);await assert.rejects(exports.save(preview.token,()=> 'epoch',async()=>{}),/export-review-stale/);
});
test('cancelled/stale export reviews write no data and mid-write privacy invalidation removes staging',async t=>{
 const {root,exports}=await setup(t);let preview=exports.prepare(input(),'old');exports.invalidate();await assert.rejects(exports.save(preview.token,()=> 'old',async()=>{}));await assert.rejects(access(join(root,'exports')));
 preview=exports.prepare(input(),'old');await assert.rejects(exports.save(preview.token,()=> 'new',async()=>{}));await assert.rejects(access(join(root,'exports')));
 preview=exports.prepare(input(),'old');let epoch='old',calls=0;await assert.rejects(exports.save(preview.token,()=>epoch,async()=>{if(++calls===3)epoch='new';}),/export-review-stale/);assert.deepEqual(await readdir(join(root,'exports')),[]);
});
test('symlinked export destinations do not modify an unrelated directory',async t=>{
 const {root,exports}=await setup(t),outside=await realpath(await mkdtemp(join(tmpdir(),'export-unrelated-')));t.after(()=>rm(outside,{recursive:true,force:true}));await symlink(outside,join(root,'exports'));const preview=exports.prepare(input(),'epoch');await assert.rejects(exports.save(preview.token,()=> 'epoch',async()=>{}));assert.deepEqual(await readdir(outside),[]);
});
