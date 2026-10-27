import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ScopedEventSet} from '../../src/core/scopedEvents';

test('partitioned event deduplication preserves exact scope boundaries, total bounds and clear semantics',()=>{
 const seen=new ScopedEventSet(),event={collectorId:'collector',environmentId:'local',workspaceId:'workspace',eventId:'same-event'};
 seen.add(event);seen.add({...event});assert.equal(seen.size,1);assert.equal(seen.has(event),true);
 for(const changed of [{collectorId:'other'},{environmentId:'remote'},{workspaceId:'other'},{worktreeId:'other'},{eventId:'new-event'}]){
  const other={...event,...changed};assert.equal(seen.has(other),false);seen.add(other);assert.equal(seen.has(other),true);
 }
 assert.equal(seen.size,6);seen.clear();assert.equal(seen.size,0);assert.equal(seen.has(event),false);
 seen.add(event);assert.equal(seen.size,1);
});
