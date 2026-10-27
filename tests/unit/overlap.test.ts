import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { overlapAdvisories } from '../../src/core/overlap';
import { FileActivityStore, type FileObservation } from '../../src/core/reducers';
import type { EventV1 } from '../../src/core/contracts';
import example from '../fixtures/core/event-v1.json';
import { normalizeCursorEnvelope } from '../../src/adapters/cursorHooks';
import type { SourceEnvelopeV1 } from '../../src/transport/sourceContracts';
const now=Date.parse('2026-10-25T12:00:00.000Z');
function fact(actor:string,call:string,phase:EventV1['phase'],at:number,operation:'read'|'edit'='edit',sourceTime=true):FileObservation{
 const e=structuredClone(example) as EventV1;e.eventId=randomUUID();e.conversationId=actor;e.operationId=e.eventId;e.operation=operation;e.sourceCallId=call;e.sourceEvent=phase==='started'?'preToolUse':'postToolUse';e.phase=phase;e.outcome=phase==='completed'?'success':'unknown';e.receivedAt=new Date(at).toISOString();e.evidence.completion=phase==='completed'?'source-reported':'not-observed';if(sourceTime)e.sourceOccurredAt=e.receivedAt;return{event:e};
}
function result(facts:FileObservation[],at=now){const store=new FileActivityStore(()=>at);for(const f of facts)store.apply(f);return overlapAdvisories(facts,store.snapshot().operations,at);}
const interval=(actor:string,call:string,start:number,end:number)=>[fact(actor,call,'started',start),fact(actor,call,'completed',end)];
test('explicit overlapping source edit intervals produce one high-attention advisory with physical scope and exact causes',()=>{
 const facts=[...interval('a','one',now-10000,now-2000),...interval('b','two',now-5000,now-1000)];const r=result(facts);
 assert.equal(r.advisories.length,1);const a=r.advisories[0]!;assert.equal(a.category,'concurrent-edits');assert.equal(a.severity,'high');assert.equal(a.conversations.length,2);assert.equal(a.eventIds.length,4);assert.ok(a.fileIdentity.includes('physical'));assert.ok(a.explanation.includes('explicit source'));assert.equal(a.limitations.some(l=>l.includes('not a confirmed conflict')),true);
});
test('receipt-near successful edit reports qualify as recent, never concurrent, without explicit source intervals',()=>{
 const a=fact('a','one','completed',now-1000,'edit',false),b=fact('b','two','completed',now,'edit',false);const r=result([a,b]);
 assert.equal(r.advisories[0]?.category,'recent-edits');assert.ok(r.advisories[0]?.explanation.includes('concurrent execution is not established'));assert.equal(result([a,b],now+30001).advisories.length,0);
 assert.equal(result([a,b],now-2000).advisories.length,0);
});
test('same conversation, reused call ambiguity, denied tools and duplicate events never manufacture distinct actors',()=>{
 const a=fact('a','one','completed',now-1000),same=fact('a','two','completed',now),b=fact('b','three','completed',now);
 assert.equal(result([a,a,same]).advisories.length,0);assert.equal(result([a,b]).advisories.length,1);assert.equal(result([a,b,a,b]).advisories.length,1);
 const reused=fact('a','one','completed',now);assert.equal(result([a,reused,b]).advisories.length,0);
 b.event.phase='failed';b.event.outcome='denied';b.event.sourceEvent='postToolUseFailure';b.event.evidence.completion='source-reported';assert.equal(result([a,b]).advisories.length,0);
});
test('physical file, worktree, environment and collector boundaries partition identical relative filenames',()=>{
 for(const dimension of ['file','worktree','environment','collector','workspace']){const a=fact('a','one','completed',now),b=fact('b','two','completed',now);
 if(dimension==='file')b.event.targets[0]!.fileKey='other';if(dimension==='worktree')b.event.worktreeId='other';if(dimension==='environment')b.event.environmentId='other';if(dimension==='collector')b.event.collectorId='other';if(dimension==='workspace')b.event.workspaceId='other';assert.equal(result([a,b]).advisories.length,0,dimension);}
});
test('hashed hints, watcher guesses, child attribution and missing conversation evidence stay unqualified',()=>{
 for(const mode of ['hint','unknown','child','ambient']){const a=fact('a','one','completed',now),b=fact('b','two','completed',now);
 if(mode==='hint'){a.event.targets=[];a.pathHint='a'.repeat(64);}if(mode==='unknown'){a.event.actorScope='unknown';a.event.evidence.attribution='unknown';}if(mode==='child'){a.event.actorScope='child';a.event.actorId='child';a.event.parentActorId='parent';a.event.evidence.attribution='child';}if(mode==='ambient'){a.event.source='filesystem';a.event.sourceEvent='fileChanged';a.event.phase='observed';a.event.outcome='unknown';a.event.actorScope='unknown';delete a.event.conversationId;delete a.event.sourceCallId;a.event.evidence={activity:'filesystem-observed',attribution:'unknown',completion:'not-observed',diskPersistence:'unknown',correlation:'unpaired',limitations:[]};}
 const store=new FileActivityStore(()=>now);for(const f of [a,b])try{store.apply(f);}catch{}const r=overlapAdvisories([a,b],store.snapshot().operations,now);assert.equal(r.advisories.length,0,mode);assert.ok(r.unqualifiedFileEvents>=1);}
});
test('possible stale context requires successful read and source-ordered intervening edit plus original edit start',()=>{
 const facts=[...interval('a','read',now-20000,now-19000).map(f=>{f.event.operation='read';return f;}),...interval('b','other',now-15000,now-10000),...interval('a','own',now-5000,now-1000)];
 assert.ok(result(facts).advisories.some(a=>a.category==='possible-stale-context'));
 for(const f of facts)delete f.event.sourceOccurredAt;assert.equal(result(facts).advisories.some(a=>a.category==='possible-stale-context'),false);
 const attempted=[fact('a','read','requested',now-20000,'read'),...interval('b','other',now-15000,now-10000),...interval('a','own',now-5000,now-1000)];assert.equal(result(attempted).advisories.some(a=>a.category==='possible-stale-context'),false);
});
test('replay order and delivery duplication preserve advisory identity; touching intervals are only recent reports',()=>{
 const facts=[...interval('a','one',now-10000,now-5000),...interval('b','two',now-5000,now)];
 assert.equal(result(facts).advisories[0]?.category,'recent-edits');assert.deepEqual(result([...facts].reverse()).advisories,result(facts).advisories);
});
test('native shared-file history retains source hints and unlinked actors rather than promoting current filesystem state',async()=>{
 const captured=JSON.parse(await readFile('tests/fixtures/cursor/concurrency.json','utf8')) as {events:Array<Record<string,unknown>>};
 const observations:FileObservation[]=[];
 const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
 for(const p of captured.events.filter(p=>p.target==='shared.txt')){
  const eventId=p.eventId as string,receivedAt=p.receivedAt as string;
  const m:NonNullable<SourceEnvelopeV1['result']['metadata']>={metadataVersion:1,eventId,receivedAt,sourceEvent:p.hookEvent as NonNullable<SourceEnvelopeV1['result']['metadata']>['sourceEvent'],sourceVersion:'3.26.16',tool:'edit',workspaceRootHashes:[hash('root')],pathHash:hash('shared.txt')};
  for(const [k,v] of [['conversationId','conversationKey'],['generationId','generationKey'],['callId','callKey']] as const)if(typeof p[v]==='string')m[k]=p[v];
  const source:SourceEnvelopeV1={transportVersion:1,eventId,receivedAt,collectorId:'fixture',environmentId:'qualified-local',workspaceId:p.rootKey as string,result:{metadata:m,counters:{unknownFields:0,sensitiveFields:0,invalidFields:0}}};
  const observation=normalizeCursorEnvelope(source);if(observation)observations.push(observation);
 }
 assert.ok(observations.length>1);const r=result(observations,Math.max(...observations.map(o=>Date.parse(o.event.receivedAt))));assert.equal(r.advisories.length,0);assert.ok(r.unqualifiedFileEvents>1);
});

test('privacy exclusions and analysis bounds remain conservative under many qualified participants',()=>{
 const a=fact('a','one','completed',now),b=fact('b','two','completed',now);a.event.targets[0]!.relativePath='.env';assert.equal(result([a,b]).advisories.length,0);
 const facts=Array.from({length:280},(_,i)=>fact('actor-'+i,'call-'+i,'completed',now-i));const r=result(facts);assert.ok(r.truncatedFileEvents>0);assert.ok(r.advisories.every(a=>a.conversations.length<=8));
});
