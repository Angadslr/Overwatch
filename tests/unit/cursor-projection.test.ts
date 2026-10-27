import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID,createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { normalizeCursorEnvelope, normalizeJournalRecord, type CursorObservation } from '../../src/adapters/cursorHooks';
import { FileActivityStore } from '../../src/core/reducers';
import { parseEvent, snapshotEvent } from '../../src/core/eventValidation';
import type { SourceEnvelopeV1,SourceMetadata } from '../../src/transport/sourceContracts';

const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
function source(hook:SourceMetadata['sourceEvent'],override:Partial<SourceMetadata>={},scope:Partial<SourceEnvelopeV1>={}):SourceEnvelopeV1 {
  const eventId=randomUUID(),receivedAt='2026-10-22T12:00:00.000Z';
  return {transportVersion:1,eventId,receivedAt,collectorId:'collector',environmentId:'local',workspaceId:'workspace',result:{metadata:{metadataVersion:1,eventId,receivedAt,sourceVersion:'3.26.16',sourceEvent:hook,workspaceRootHashes:[hash('root')],conversationId:hash('conversation'),generationId:hash('generation'),callId:hash('call'),tool:'read',pathHash:hash('read.txt'),...override},counters:{unknownFields:0,sensitiveFields:0,invalidFields:0}},...scope};
}
function mapped(e:SourceEnvelopeV1):CursorObservation {const o=normalizeCursorEnvelope(e);assert.ok(o);assert.equal(parseEvent(JSON.stringify(o.event)).ok,true);return o;}
function apply(store:FileActivityStore,e:SourceEnvelopeV1):CursorObservation {const o=mapped(e);store.apply(o);return o;}

test('pre-read, tool completion and edit report preserve independent evidence',()=>{
  const store=new FileActivityStore();
  const pre=apply(store,source('beforeReadFile'));
  assert.equal(pre.event.phase,'requested');assert.equal(pre.event.outcome,'unknown');assert.equal(pre.event.actorScope,'unknown');
  assert.equal(store.snapshot().operations[0]?.missingCompletion,true);assert.equal(store.snapshot().files[0]?.completedReads,0);
  const post=apply(store,source('postToolUse'));
  assert.equal(post.event.evidence.completion,'source-reported');assert.equal(store.snapshot().files[0]?.completedReads,1);
  const edit=apply(store,source('afterFileEdit',{tool:'unknown'}));
  assert.equal(edit.event.phase,'observed');assert.equal(edit.event.sourceCallId,undefined);assert.equal(edit.event.evidence.correlation,'unpaired');
  const file=store.snapshot().files[0]!;assert.equal(file.editReports,1);assert.equal(file.completedEditTools,0);assert.equal(file.diskPersistence,'unknown');assert.equal(file.acceptance,'unknown');assert.equal(file.identityKind,'source-hint');
});

test('generic/specialized starts join only explicit scope, preserve repeated reads and deduplicate event delivery',()=>{
  const store=new FileActivityStore();
  apply(store,source('preToolUse'));apply(store,source('beforeReadFile'));const terminal=apply(store,source('postToolUse'));
  assert.equal(store.snapshot().operations.length,1);assert.equal(store.snapshot().files[0]?.attempts,1);
  assert.equal(store.apply(terminal),false);assert.equal(store.snapshot().files[0]?.completedReads,1);
  apply(store,source('preToolUse',{callId:hash('second')}));apply(store,source('postToolUse',{callId:hash('second')}));
  assert.equal(store.snapshot().operations.length,2);assert.equal(store.snapshot().files[0]?.completedReads,2);
});

test('completion-before-start repairs missing-start without receipt-time matching',()=>{
  const store=new FileActivityStore();apply(store,source('postToolUse'));
  assert.equal(store.snapshot().operations[0]?.missingStart,true);
  const start=source('beforeReadFile');start.receivedAt='2026-10-22T12:01:00.000Z';start.result.metadata!.receivedAt=start.receivedAt;apply(store,start);
  assert.equal(store.snapshot().operations[0]?.state,'completed');assert.equal(store.snapshot().operations[0]?.missingStart,false);assert.equal(store.snapshot().operations[0]?.missingCompletion,false);
});

test('missing call or generation never joins; same-kind call reuse becomes ambiguous with every observation retained',()=>{
  const store=new FileActivityStore();
  const noCall=source('beforeReadFile');delete noCall.result.metadata!.callId;
  apply(store,noCall);apply(store,source('postToolUse'));
  assert.equal(store.snapshot().operations.length,2);
  const noGeneration=source('postToolUse');delete noGeneration.result.metadata!.generationId;
  const o=apply(store,noGeneration);assert.equal(o.event.evidence.correlation,'ambiguous');assert.equal(store.snapshot().operations.length,3);
  const reused=new FileActivityStore();apply(reused,source('preToolUse'));apply(reused,source('beforeReadFile'));apply(reused,source('postToolUse'));apply(reused,source('preToolUse'));apply(reused,source('postToolUse'));
  const snapshot=reused.snapshot();assert.equal(snapshot.operations.length,1);assert.equal(snapshot.operations[0]?.state,'ambiguous');assert.equal(snapshot.operations[0]?.eventIds.length,5);assert.equal(snapshot.files[0]?.completedReads,0);assert.equal(snapshot.files[0]?.ambiguousObservations,5);
});

test('operation kind, conversation, generation, worktree and installation partition joins',()=>{
  const store=new FileActivityStore();apply(store,source('preToolUse'));apply(store,source('postToolUse'));
  apply(store,source('preToolUse',{tool:'edit'}));apply(store,source('postToolUse',{tool:'edit'}));
  apply(store,source('beforeReadFile',{conversationId:hash('other')}));
  apply(store,source('beforeReadFile',{generationId:hash('other')}));
  apply(store,source('beforeReadFile',{}, {worktreeId:'worktree-2'}));
  apply(store,source('beforeReadFile',{}, {collectorId:'other'}));
  apply(store,source('beforeReadFile',{}, {environmentId:'remote-namespace'}));
  apply(store,source('beforeReadFile',{}, {workspaceId:'workspace-2'}));
  assert.equal(store.snapshot().operations.length,8);assert.equal(store.snapshot().files.length,5);
  assert.equal(store.snapshot().operations.every(o=>o.state!=='ambiguous'),true);
});

test('denial, cancellation, unknown tool/output categories and shell/MCP boundaries stay explicit',()=>{
  const denied=mapped(source('postToolUseFailure',{failureType:'permission_denied'}));assert.equal(denied.event.phase,'failed');assert.equal(denied.event.outcome,'denied');
  const aborted=mapped(source('postToolUseFailure',{failureType:'error',interrupted:true}));assert.equal(aborted.event.phase,'cancelled');assert.equal(aborted.event.outcome,'aborted');
  const unknown=mapped(source('postToolUse',{tool:'unknown'}));assert.equal(unknown.event.operation,'unknown');assert.deepEqual(unknown.event.targets,[]);
  for(const hook of ['afterShellExecution','afterMCPExecution'] as const){const o=mapped(source(hook));assert.equal(o.event.phase,'observed');assert.equal(o.event.outcome,'unknown');assert.deepEqual(o.event.targets,[]);assert.equal(o.pathHint,undefined);}
  const malformed=source('postToolUse') as unknown as Record<string,unknown>;malformed.tool_output='FAKE_SECRET_MARKER';assert.equal(normalizeCursorEnvelope(malformed as unknown as SourceEnvelopeV1),undefined);
});

test('edit observations remain separate, lifecycle stop ends only generation and child relationships do not leak into file ownership',()=>{
  const store=new FileActivityStore();apply(store,source('preToolUse',{tool:'edit'}));apply(store,source('afterFileEdit',{tool:'unknown'}));apply(store,source('postToolUse',{tool:'edit'}));
  assert.equal(store.snapshot().operations.length,2);assert.equal(store.snapshot().files[0]?.completedEditTools,1);assert.equal(store.snapshot().files[0]?.editReports,1);
  const stop=mapped(source('stop',{tool:'unknown',status:'aborted'}));assert.equal(stop.event.lifecycleScope,'generation');assert.equal(stop.event.phase,'cancelled');
  const child=mapped(source('subagentStart',{tool:'unknown',subagentId:hash('child'),parentConversationId:hash('parent')}));assert.equal(child.event.actorScope,'child');assert.equal(child.event.actorId,hash('child'));
  const file=mapped(source('beforeReadFile',{subagentId:hash('child'),parentConversationId:hash('parent')}));assert.equal(file.event.actorScope,'unknown');assert.equal(file.event.actorId,undefined);
  assert.equal(normalizeCursorEnvelope(source('sessionEnd')),undefined);
});

test('diagnostic envelopes replay with a stable time and sequence; no synthetic failure outcome',()=>{
  const e=source('preToolUse');delete e.result.metadata;e.result.counters.gap='invalid-json';
  const o=normalizeJournalRecord({journalVersion:1,ingestSequence:7,envelope:e});assert.ok(o);assert.equal(o.event.receivedAt,e.receivedAt);assert.equal(o.event.ingestSequence,7);assert.equal(o.event.sourceEvent,'transportGap');assert.equal(o.event.outcome,'unknown');
  const store=new FileActivityStore();store.apply(o);store.apply(o);assert.equal(store.snapshot().transportGaps,1);assert.equal(store.snapshot().files.length,0);
});

test('conflicting target hints are not collapsed into a completed file read',()=>{
  const store=new FileActivityStore();apply(store,source('preToolUse'));apply(store,source('postToolUse',{pathHash:hash('other.txt')}));
  assert.equal(store.snapshot().operations[0]?.state,'ambiguous');assert.equal(store.snapshot().files.every(f=>f.completedReads===0),true);
});

test('detail eviction preserves deduplication and does not restore certainty to a retired source-call bucket',()=>{
  const store=new FileActivityStore();const original=source('beforeReadFile');const originalObservation=apply(store,original);
  for(let i=0;i<10000;i++)apply(store,source('beforeReadFile',{callId:hash('bounded-'+i)}));
  assert.ok(store.snapshot().coverageDropped>0);assert.equal(store.apply(originalObservation),false);
  const late=mapped(source('postToolUse')),checked=snapshotEvent(late.event);assert.equal(checked.ok,true);if(!checked.ok)throw new Error('fixture-rejected');
  const immutable=JSON.stringify(checked.event);store.apply({...late,event:checked.event});assert.equal(JSON.stringify(checked.event),immutable);
  const snapshot=store.snapshot();assert.ok(snapshot.operations.length<=10000);
  const retired=snapshot.operations.find(o=>o.eventIds.includes(original.eventId));assert.equal(retired,undefined);
  assert.ok(snapshot.operations.some(o=>o.state==='ambiguous'));assert.equal(snapshot.files[0]?.completedReads,0);
});

test('invalid fields remain an explicit source coverage limitation',()=>{
  const e=source('preToolUse');e.result.counters.invalidFields=1;
  assert.ok(mapped(e).event.evidence.limitations.includes('source-coverage-partial'));
});

test('T02/T03 captured source metadata maps deterministically without inventing payload fields or actor joins',async()=>{
  const tools:Record<string,SourceMetadata['tool']>={Read:'read',ReadFile:'read',read_file:'read',read_file_v2:'read',Write:'edit',Edit:'edit',EditFile:'edit',StrReplace:'edit',Shell:'shell',Bash:'shell',MCP:'mcp',Task:'task',unknown:'unknown'};
  let checked=0;
  for(const name of ['operations','failures','lifecycle','concurrency','worktrees']){
    const fixture=JSON.parse(await readFile(`tests/fixtures/cursor/${name}.json`,'utf8')) as {events?:Array<Record<string,unknown>>};
    for(const p of fixture.events??[]){
      const eventId=p.eventId as string,receivedAt=p.receivedAt as string;
      const m:SourceMetadata={metadataVersion:1,eventId,receivedAt,sourceEvent:p.hookEvent as SourceMetadata['sourceEvent'],sourceVersion:p.sourceVersion as string,workspaceRootHashes:[p.rootKey as string],tool:tools[p.toolName as string]??'unknown'};
      for(const [target,key] of [['conversationId','conversationKey'],['generationId','generationKey'],['callId','callKey'],['parentConversationId','parentConversationKey'],['subagentId','subagentKey']] as const) if(typeof p[key]==='string')m[target]=p[key] as string;
      if(typeof p.target==='string')m.pathHash=hash('fixture-relative\0'+p.target);
      if(typeof p.durationMs==='number')m.durationMs=p.durationMs;
      if(typeof p.status==='string')m.status=p.status as NonNullable<SourceMetadata['status']>;
      if(typeof p.failure==='string')m.failureType=p.failure as NonNullable<SourceMetadata['failureType']>;
      const e:SourceEnvelopeV1={transportVersion:1,eventId,receivedAt,collectorId:'fixture',environmentId:'qualified-local',workspaceId:p.rootKey as string,result:{metadata:m,counters:{unknownFields:0,sensitiveFields:0,invalidFields:0}}};
      const a=normalizeCursorEnvelope(e),b=normalizeCursorEnvelope(e);assert.ok(a,`${name}:${String(p.hookEvent)}`);assert.deepEqual(a,b);assert.equal(parseEvent(JSON.stringify(a.event)).ok,true);
      if(a.event.operation==='read'||a.event.operation==='edit')assert.equal(a.event.actorScope,'unknown');
      if(m.sourceEvent==='afterFileEdit'){assert.equal(a.event.phase,'observed');assert.equal(a.event.sourceCallId,undefined);}
      assert.equal(a.event.evidence.diskPersistence,'not-observed');checked++;
    }
  }
  assert.ok(checked>30);
});
