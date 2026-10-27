import * as vscode from 'vscode';
import assert from 'node:assert/strict';
import type { SupervisionApi } from '../../src/commands';
import { AttentionState } from '../../src/core/attention';
export async function verifySelfCheck(api:SupervisionApi):Promise<string[]> {
 assert.ok(api.manager);const operations=api.manager.store.snapshot().operations.length,gaps=api.manager.health.snapshot().sourceGapEvents;
 const result=await vscode.commands.executeCommand<{state:string}>('overwatch.supervision.runSelfCheck');assert.equal(result?.state,'passed');
 assert.equal(api.manager.health.snapshot().nativeDelivery,'awaiting-first-event');assert.equal(api.manager.health.snapshot().sourceGapEvents,gaps);assert.equal(api.manager.store.snapshot().operations.length,operations);
 assert.ok([...api.manager.evidence.values()].some(o=>o.event.source==='self-check'&&o.event.sourceEvent==='selfCheck'));
 assert.equal(api.healthTree.getChildren().find(n=>n.id==='helper')?.description,'response-verified');assert.equal(api.healthTree.getChildren().find(n=>n.id==='ingestion')?.description,'record-observed');assert.equal(api.healthTree.getChildren().find(n=>n.id==='native')?.description,'awaiting-first-event');
 return ['explicit helper/spool/collector self-check passes with a diagnostic identity, creates no agent operation and cannot verify native delivery'];
}
export async function verifyAttention(api:SupervisionApi):Promise<string[]> {
 assert.ok(api.manager);assert.equal(vscode.workspace.getConfiguration('agentSupervision').get('notifications'),false);
 const unqualified=api.attention.snapshot().find(i=>i.category==='unqualified-file-evidence');assert.ok(unqualified);assert.equal(unqualified.severity,'information');
 assert.ok(api.attention.snapshot().every(i=>!['concurrent-edits','recent-edits','possible-stale-context'].includes(i.category)));
 assert.ok(String(api.attentionTree.getTreeItem(unqualified).tooltip).includes('No physical conflict'));
 const history=api.manager.evidence.size;
 const acknowledged=await vscode.commands.executeCommand<{ok:boolean}>('overwatch.supervision.acknowledgeAttention',unqualified.id);assert.equal(acknowledged?.ok,true);
 const muted=await vscode.commands.executeCommand<{ok:boolean}>('overwatch.supervision.toggleMuteAttention',unqualified.id);assert.equal(muted?.ok,true);
 const restored=new AttentionState(JSON.parse(JSON.stringify(api.attention.preferences())));restored.update([unqualified]);assert.equal(restored.snapshot()[0]?.muted,true);assert.equal(restored.snapshot()[0]?.acknowledged,true);
 assert.equal(api.manager.evidence.size,history);assert.equal(api.manager.enabled,true);
 const inspected=await vscode.commands.executeCommand<{ok:boolean}>('overwatch.supervision.inspectAttention',unqualified.id);assert.equal(inspected?.ok,true);assert.ok(api.details.snapshot().text.includes('Event history and agent execution are unchanged'));
 return ['Attention keeps unqualified native path/actor evidence informational, defaults notifications off, and persists acknowledge/mute without deleting history or controlling agents'];
}
