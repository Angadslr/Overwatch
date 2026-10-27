import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AttentionState, type AttentionCandidate } from '../../src/core/attention';
const candidate=(key='condition',id='episode-a'):AttentionCandidate=>({id,conditionKey:key,category:'recent-edits',severity:'medium',title:'Recent edit reports',explanation:'Distinct proven conversations reported edits.',eventIds:['event-a','event-b'],conversations:['a','b'],fileIdentity:'physical-key',limitations:['Not a confirmed conflict.'],notifyEligible:true});
test('notifications default off and a continuously active condition retains one identity despite changing evidence windows',()=>{
 const state=new AttentionState(),a=candidate();state.update([a]);assert.deepEqual(state.notifications(false,0),[]);assert.equal(state.notifications(true,1).length,1);
 state.update([{...a,id:'episode-b',eventIds:['event-b','event-c']}]);assert.equal(state.snapshot()[0]?.id,'episode-a');assert.equal(state.notifications(true,2).length,0);assert.deepEqual(a.eventIds,['event-a','event-b']);
});
test('acknowledge/mute affect local projection, persist controls and never erase source history',()=>{
 const state=new AttentionState(),a=candidate();state.update([a]);assert.equal(state.acknowledge(a.id),true);assert.equal(state.toggleMute(a.id),true);assert.deepEqual(a.eventIds,['event-a','event-b']);
 const restored=new AttentionState(JSON.parse(JSON.stringify(state.preferences())));restored.update([a]);assert.equal(restored.snapshot()[0]?.acknowledged,true);assert.equal(restored.snapshot()[0]?.muted,true);assert.deepEqual(restored.notifications(true,1),[]);
 assert.equal(restored.toggleMute(a.id),true);assert.equal(restored.snapshot()[0]?.muted,false);assert.equal(restored.acknowledge('missing'),false);
});
test('a disappeared condition starts a new unacknowledged episode while a muted rule stays muted',()=>{
 const state=new AttentionState();state.update([candidate()]);state.acknowledge('episode-a');state.update([]);state.update([candidate('condition','episode-new')]);assert.equal(state.snapshot()[0]?.acknowledged,false);assert.equal(state.notifications(true,100).length,1);
 state.toggleMute('episode-new');state.update([]);state.update([candidate('condition','episode-next')]);assert.equal(state.snapshot()[0]?.muted,true);
});
test('notifications are capped at three per minute, keep informational/read items quiet and recover after the window',()=>{
 const state=new AttentionState();state.update([0,1,2,3,4].map(i=>candidate('condition-'+i,'episode-'+i)).concat([{...candidate('read','read'),severity:'information',notifyEligible:false}]));
 assert.equal(state.notifications(true,100).length,3);assert.equal(state.notifications(true,101).length,0);assert.equal(state.notifications(true,60101).length,2);
 assert.equal(state.notifications(true,60102).length,0);
});
test('malformed preferences and presentation bounds fail safely without importing arbitrary saved data',()=>{
 for(const raw of [null,{version:2,acknowledged:[],muted:[]},{version:1,acknowledged:[false],muted:[]}])assert.equal(new AttentionState(raw).preferenceInvalid,true);
 const state=new AttentionState();state.update(Array.from({length:250},(_,i)=>candidate('key-'+i,'id-'+i)));assert.equal(state.snapshot().length,200);
});
