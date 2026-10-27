import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activityBadge, changedBadgeKeys, projectFiles, RECENT_ACTIVITY_MS } from '../../src/ui/fileProjection';
import type { ActivityNode } from '../../src/ui/files';
import type { EventV1 } from '../../src/core/contracts';
import type { OperationActivity } from '../../src/core/reducers';

const now = Date.parse('2026-10-25T12:00:00.000Z');
function node(id: string, op: 'read'|'edit' = 'read', worktreeId = 'worktree-a'): ActivityNode {
 const event: EventV1 = { schemaVersion: 1, eventId: id, collectorId: 'collector', environmentId: 'local', workspaceId: 'workspace', worktreeId,
 source: 'cursor-hook', sourceEvent: 'postToolUse', receivedAt: new Date(now).toISOString(), actorScope: 'unknown', conversationId: id,
 operationId: id, operation: op, phase: 'completed', outcome: 'success', targets: [],
 evidence: { activity: 'source-reported', attribution: 'unknown', completion: 'source-reported', diskPersistence: 'unknown', correlation: 'unpaired', limitations: [] } };
 const operation: OperationActivity = { key: id, operation: op, eventIds: [id], state: 'completed', outcome: 'success', hasStart: true, hasTerminal: true,
 missingStart: false, missingCompletion: false, fileIdentities: ['hint'], liveState: 'terminal', lastReceivedAt: event.receivedAt };
 return { kind: 'file', id, label: 'read.txt', description: 'Completed · source report', hint: 'a'.repeat(64), observation: { event, pathHint: 'a'.repeat(64) }, operation };
}
function roots(...children: ActivityNode[]): ActivityNode[] {
 return [{ kind: 'session', id: 'session', label: 'Session 1', description: 'Actor unverified', children }];
}

test('file grouping shares conversation operations while partitioning worktrees, environments and physical evidence', () => {
 const a=node('one'),b=node('two','edit'),c=node('three','read','worktree-b');
 const rows=projectFiles(roots(a,b,c));assert.equal(rows.length,2);
 const shared=rows.find(r=>r.children.length===2)!;assert.equal(shared.sessions.length,2);assert.equal(shared.identity,'source path hint');
 assert.equal(shared.children[0]?.operation,a.operation);assert.ok(shared.children[0]?.description.startsWith('Session 1'));
 assert.ok(rows.every(r=>r.scopeLabel.includes('Worktree worktree-')));
 const external=node('four');external.observation!.event.environmentId='other';assert.equal(projectFiles(roots(a,external)).length,2);
 const {conversationId, ...ambientEvent}=a.observation!.event;
 const physical:ActivityNode={kind:'local',id:'local',label:'read.txt',description:'Actor unknown',localObservation:{kind:'editor-save',currentPresence:'file',event:{...ambientEvent,targets:[{pathScope:'workspace',pathKind:'file',relativePath:'read.txt',fileKey:'physical'}]}}};
 const grouped=projectFiles(roots(a,physical));assert.equal(grouped.length,2);assert.equal(grouped.find(r=>r.identity==='physical sample')?.sessions.length,0);
});

test('badge priority is attention, edit, read, uncertainty and recency never changes completed evidence', () => {
 const read=node('read'),edit=node('edit','edit');const rows=projectFiles(roots(read,edit));
 assert.equal(activityBadge(rows,now)?.badge,'W');assert.equal(activityBadge(projectFiles(roots(read)),now)?.badge,'R');
 edit.operation!.liveState='ambiguous';assert.equal(activityBadge(projectFiles(roots(read,edit)),now)?.badge,'!');
 const local:ActivityNode={kind:'local',id:'local',label:'read.txt',description:'Actor unknown',localObservation:{kind:'editor-save',currentPresence:'file',event:{...read.observation!.event,targets:[{pathScope:'workspace',pathKind:'file',relativePath:'read.txt',fileKey:'physical'}]}}};
 const ambient=projectFiles(roots(local));assert.equal(activityBadge(ambient,now)?.badge,'?');assert.ok(activityBadge(ambient,now)?.description.includes('actor unknown'));
 const search=node('search');search.operation!.operation='search';search.observation!.event.operation='search';
 assert.ok(activityBadge(projectFiles(roots(search)),now)?.description.includes('Uncertain source file activity'));
 assert.equal(activityBadge(rows,now+RECENT_ACTIVITY_MS),undefined);assert.equal(read.operation!.state,'completed');
 assert.equal(activityBadge(rows,now-1),undefined);
});

test('decoration diff emits only affected locators and includes removals', () => {
 const before=new Map([['a','R'],['b','W'],['unchanged','?']]);const after=new Map([['a','!'],['c','R'],['unchanged','?']]);
 assert.deepEqual(changedBadgeKeys(before,after),['a','b','c']);assert.deepEqual(changedBadgeKeys(after,new Map(after)),[]);
});

test('representative volume retains every operation, exact session counts and leaves tools unresolved', () => {
 const children=Array.from({length:200},(_,i)=>node('session-'+i,i%2?'edit':'read'));
 const rows=projectFiles(roots(...children,{kind:'tool',id:'shell',label:'Shell tool',description:'Internals unknown'}));
 assert.equal(rows.length,1);assert.equal(rows[0]?.children.length,200);assert.equal(rows[0]?.sessions.length,200);
 assert.equal(activityBadge(rows,now)?.badge,'W');assert.ok(activityBadge(rows,now)?.description.includes('200 recent source sessions'));
});
