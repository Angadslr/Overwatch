import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ActivityViewState, activityKey, matchesActivity, checkedFilters, DISPLAY_LIMIT, type ActivityEntry } from '../../src/ui/viewState';
import { conversationKey } from '../../src/core/identity';
import type { ActivityNode } from '../../src/ui/files';
import type { EventV1 } from '../../src/core/contracts';
const now = Date.parse('2026-10-25T12:00:00.000Z');
function entry(id: string, conversation = 'session-a', operation: EventV1['operation'] = 'read', receipt = now): ActivityEntry {
 const event: EventV1 = {schemaVersion:1,eventId:id,collectorId:'collector',environmentId:'local',workspaceId:'workspace',conversationId:conversation,
 source:'cursor-hook',sourceEvent:'postToolUse',receivedAt:new Date(receipt).toISOString(),actorScope:'unknown',operationId:id,operation,phase:'completed',outcome:'success',targets:[],
 evidence:{activity:'source-reported',attribution:'unknown',completion:'source-reported',diskPersistence:'unknown',correlation:'unpaired',limitations:[]}};
 return {key:activityKey(event),event,label:'read.txt',observation:{event,pathHint:'a'.repeat(64)},operation:{key:id,operation,eventIds:[id],state:'completed',outcome:'success',hasStart:true,hasTerminal:true,missingStart:false,missingCompletion:false,fileIdentities:[],liveState:'terminal',lastReceivedAt:event.receivedAt}};
}
function roots(entries: ActivityEntry[]): ActivityNode[] {
 const groups=new Map<string,ActivityNode>();
 for(const e of entries){const key=conversationKey(e.event,e.event.conversationId!);let group=groups.get(key);if(!group){group={kind:'session',id:key,label:e.event.conversationId!,description:'Source session · 1 source operations',children:[]};groups.set(key,group);}
 group.children!.push({kind:'file',id:e.operation!.key,label:e.label,description:'Read completed',hint:e.observation!.pathHint!,observation:e.observation!,operation:e.operation!});}
 return [...groups.values()];
}
test('conversation, operation, time and evidence predicates combine without changing source facts',()=>{
 const a=entry('a'),b=entry('b','session-b','edit',now-1000),old=entry('old','session-a','read',now-900001);
 const filters={conversation:conversationKey(a.event,'session-a'),operation:'read' as const,withinMs:900000,evidence:'source-reported' as const};
 assert.equal(matchesActivity(a,filters,now),true);assert.equal(matchesActivity(b,filters,now),false);assert.equal(matchesActivity(old,filters,now),false);
 assert.equal(matchesActivity(entry('future','session-a','read',now+1),{withinMs:900000},now),false);
 a.operation!.state='ambiguous';assert.equal(matchesActivity(a,{evidence:'ambiguous'},now),true);assert.equal(a.event.phase,'completed');
});
test('chronology and identical matching event IDs drive list and conversation/file rows; clearing restores everything',()=>{
 const a=entry('a'),b=entry('b','session-b','edit',now-1000),state=new ActivityViewState();state.update([a,b],roots([a,b]),now);
 assert.deepEqual(state.entries().map(e=>e.event.eventId),['b','a']);state.setFilters({operation:'read'});
 assert.deepEqual(state.entries().map(e=>e.event.eventId),['a']);assert.equal(state.roots().length,1);assert.equal(state.roots()[0]?.children?.length,1);
 assert.equal(state.roots()[0]?.children?.[0]?.observation?.event.eventId,'a');state.setFilters({});assert.equal(state.entries().length,2);assert.equal(state.roots().length,2);
});
test('freeze captures immutable rows and time while collection delivers new facts; resume includes every retained arrival',()=>{
 const a=entry('a'),b=entry('b','session-b','edit',now+1),state=new ActivityViewState();state.update([a],roots([a]),now);assert.equal(state.toggleFreeze(),true);
 const before=JSON.stringify(state.roots());a.label='changed live label';state.update([a,b],roots([a,b]),now+1);state.update([a,b],roots([a,b]),now+2);
 assert.equal(state.entries()[0]?.label,'read.txt');assert.equal(state.at,now);assert.equal(state.pending,1);assert.equal(JSON.stringify(state.roots()),before);
 assert.ok(state.status().includes('collection continues'));assert.ok(state.status(false).includes('collection is off'));
 assert.equal(state.toggleFreeze(),false);assert.equal(state.entries().length,2);assert.equal(state.pending,0);assert.equal(state.resumed,1);assert.equal(state.at,now+2);
});
test('filters remain usable while frozen and privacy reset invalidates frozen inspection handles',()=>{
 const a=entry('a'),b=entry('b','session-b','edit'),state=new ActivityViewState();state.update([a,b],roots([a,b]),now);state.toggleFreeze();state.setFilters({operation:'edit'});
 assert.equal(state.entries()[0]?.key,b.key);assert.equal(state.find(a.key),undefined);assert.ok(state.find(b.key));state.reset();assert.equal(state.frozen,false);assert.equal(state.entries().length,0);assert.equal(state.find(b.key),undefined);
});
test('time filters use the frozen reference time and source namespace prevents a conversation filter crossing worktrees',()=>{
 const a=entry('a','same','read',now-900),b=entry('b','same','read',now-900);b.event.worktreeId='other';b.key=activityKey(b.event);
 const state=new ActivityViewState();state.update([a,b],roots([a,b]),now);state.setFilters({conversation:conversationKey(a.event,'same'),withinMs:1000});state.toggleFreeze();state.update([a,b],roots([a,b]),now+2000);
 assert.equal(state.entries().length,1);state.toggleFreeze();assert.equal(state.entries().length,0);
});
test('clock-only updates expire live filters without counting arrivals or changing a frozen snapshot',()=>{
 const a=entry('clock','same','read',now-900),state=new ActivityViewState();
 state.update([a],roots([a]),now);state.setFilters({withinMs:1000});state.toggleFreeze();
 assert.equal(state.tick(now+2000),false);assert.equal(state.entries().length,1);assert.equal(state.at,now);assert.equal(state.pending,0);
 state.toggleFreeze();assert.equal(state.entries().length,0);assert.equal(state.at,now+2000);assert.equal(state.resumed,0);
 state.setFilters({});assert.equal(state.entries().length,1);assert.equal(a.event.receivedAt,new Date(now-900).toISOString());
 state.setFilters({withinMs:1000});assert.equal(state.tick(now),true);assert.equal(state.tick(now+100),false);assert.equal(state.tick(now+101),true);
});
test('display capacity is explicit and does not evict or mutate collector-owned inputs',()=>{
 const entries=Array.from({length:DISPLAY_LIMIT+3},(_,i)=>entry(String(i),'same','read',now+i));const state=new ActivityViewState();state.update(entries,[],now+DISPLAY_LIMIT+4);
 assert.equal(state.entries().length,DISPLAY_LIMIT);assert.equal(entries.length,DISPLAY_LIMIT+3);assert.ok(state.status().includes('3 older events'));assert.equal(state.entries()[0]?.event.eventId,'3');
});
test('malformed filters fail closed and do not overwrite existing predicates',()=>{
 const state=new ActivityViewState();state.setFilters({operation:'read'});for(const input of [null,[],{operation:'command'},{withinMs:0},{withinMs:86400001},{evidence:'certain'},{extra:true},{conversation:123}])assert.throws(()=>state.setFilters(input));
 assert.deepEqual(state.activeFilters,{operation:'read'});assert.deepEqual(checkedFilters({}),{});
});
test('provider projection is reused until evidence, filters, freeze or a time boundary changes',()=>{
 const a=entry('cached','same','read',now-900),state=new ActivityViewState();state.update([a],roots([a]),now);
 const first=state.roots();assert.equal(state.roots(),first);state.tick(now+1);assert.equal(state.roots(),first);
 state.setFilters({withinMs:1000});const timed=state.roots();assert.notEqual(timed,first);state.tick(now+101);
 assert.equal(state.entries().length,0);assert.equal(state.roots()[0]?.kind,'message');
 state.tick(now);state.toggleFreeze();const frozen=state.roots();state.tick(now+2000);assert.equal(state.roots(),frozen);
 state.toggleFreeze();assert.equal(state.entries().length,0);state.setFilters({});assert.equal(state.entries().length,1);
 state.update([],[],now+3000);assert.equal(state.entries().length,0);state.reset();assert.equal(state.roots()[0]?.id,'display-empty');
});
