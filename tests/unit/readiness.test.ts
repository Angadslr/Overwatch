import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readinessIssues, type ReadinessInput } from '../../src/core/readiness';
import { CollectorHealth } from '../../src/core/health';
const input=():ReadinessInput=>{const h=new CollectorHealth();h.beginCollection();return{registered:true,owner:true,supported:true,health:h.snapshot(),check:{state:'passed'},counters:{accepted:1,rejected:0,failures:0},recoveredTail:false};};
test('readiness separates a passed helper/ingestion check from ordinary native delivery and partial coverage',()=>{
 const value=input();assert.equal(value.health.nativeDelivery,'awaiting-first-event');assert.equal(value.health.sourceCoverage,'partial');assert.deepEqual(readinessIssues(value),[]);
});
test('each failing layer has a specific safe next action rather than a raw exception',()=>{
 const cases:Array<[string,(v:ReadinessInput)=>void]>=[['unsupported-environment',v=>v.supported=false],['collection-off',v=>v.owner=false],['helper-check-failed',v=>v.check.state='launch-failed'],['delivery-check-failed',v=>v.check.state='delivery-timeout'],['collector-disconnected',v=>v.health.transport='disconnected'],['schema-rejections',v=>v.counters.schemaRejected=1],['scope-rejections',v=>v.counters.scopeRejected=1],['privacy-policy-gap',v=>v.health.privacy.policyUnavailable=1],['excluded-or-unresolved',v=>v.health.privacy.excluded=1],['transport-failures',v=>v.counters.failures=1],['recovered-torn-tail',v=>v.recoveredTail=true],['source-gaps',v=>v.health.sourceGapEvents=1]];
 for(const [code,change]of cases){const v=input();change(v);const issue=readinessIssues(v).find(i=>i.code===code);assert.ok(issue,code);assert.ok(issue.action.length>20);assert.equal(JSON.stringify(issue).includes('FAKE_SECRET'),false);}
});
test('bounded queue sampling discloses lower-bound count and oldest observed age without payload details',()=>{
 const v=input();v.queue={sampledAt:'2026-10-25T12:00:00.000Z',readyFiles:256,oldestObservedAgeMs:6000,incomplete:true};const issues=readinessIssues(v);assert.equal(issues[0]?.code,'queue-backlog');assert.ok(issues[0]?.message.includes('at least 256'));assert.ok(issues[0]?.action.includes('bounded'));
});
