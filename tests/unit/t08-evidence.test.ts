import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';
import {FileActivityStore} from '../../src/core/reducers';
import {normalizeJournalRecord} from '../../src/adapters/cursorHooks';
import {parseSource} from '../../src/transport/sourceValidation';
import type {SourceJournalRecord} from '../../src/transport/journal';

test('T08 captured native source journal replays the visible fixture evidence with unknown persistence and actor ownership',async()=>{
 const fixture=JSON.parse(await readFile('tests/fixtures/cursor/t08-journey.json','utf8')) as {sourceJournal:SourceJournalRecord[];disabledVerification:{publisherEnabled:boolean;ownedHooksPresent:boolean;journalBeforeDisabledRead:number;journalAfterDisabledRead:number};latency:{sampleCount:number;minMs:number;maxMs:number}};
 const store=new FileActivityStore();
 for(const record of fixture.sourceJournal){assert.ok(parseSource(Buffer.from(JSON.stringify(record.envelope))));const observation=normalizeJournalRecord(record);assert.ok(observation);assert.equal(observation.event.actorScope,'unknown');assert.equal(observation.event.evidence.diskPersistence,'not-observed');store.apply(observation);assert.equal(store.apply(observation),false);}
 const snapshot=store.snapshot();assert.equal(snapshot.operations.length,5);assert.equal(snapshot.files.length,2);
 assert.equal(snapshot.files.reduce((n,f)=>n+f.completedReads,0),3);assert.equal(snapshot.files.reduce((n,f)=>n+f.completedEditTools,0),1);assert.equal(snapshot.files.reduce((n,f)=>n+f.editReports,0),1);
 assert.equal(fixture.disabledVerification.publisherEnabled,false);assert.equal(fixture.disabledVerification.ownedHooksPresent,false);assert.equal(fixture.disabledVerification.journalBeforeDisabledRead,fixture.disabledVerification.journalAfterDisabledRead);
 assert.equal(fixture.latency.sampleCount,6);assert.ok(fixture.latency.minMs<=fixture.latency.maxMs);
 assert.equal(JSON.stringify(fixture).includes('Invented T08 read fixture:'),false);assert.equal(JSON.stringify(fixture).includes('Invented T08 edit fixture:'),false);
});

test('native Activity Bar container IDs satisfy the measured host contract and every contributed view has a container',async()=>{
 const manifest=JSON.parse(await readFile('package.json','utf8')) as {contributes:{viewsContainers:{activitybar:Array<{id:string;icon:string}>};views:Record<string,unknown>}};
 const ids=new Set(manifest.contributes.viewsContainers.activitybar.map(c=>c.id));
 for(const container of manifest.contributes.viewsContainers.activitybar){assert.match(container.id,/^[A-Za-z0-9_-]+$/);await access(container.icon);}
 for(const key of Object.keys(manifest.contributes.views))assert.ok(ids.has(key));
});
