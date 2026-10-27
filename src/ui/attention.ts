import * as vscode from 'vscode';
import type { PluginManager } from '../integration/pluginManager';
import { overlapAdvisories } from '../core/overlap';
import { fromOverlap, type AttentionCandidate, type AttentionItem } from '../core/attention';

export function attentionCandidates(manager: PluginManager, now: number): AttentionCandidate[] {
  const snapshot = manager.store.snapshot(), observations = [...manager.evidence.values()];
  const overlap = overlapAdvisories(observations, snapshot.operations, now, 30000, manager.exclusions);
  const items: AttentionCandidate[] = overlap.advisories.map(fromOverlap);
  for (const operation of snapshot.operations.filter(o => ['ambiguous', 'completion-not-observed', 'unknown-after-reload'].includes(o.liveState)).slice(-100)) {
    const event = operation.eventIds.map(id => manager.evidence.get(id)?.event).find(Boolean);
    items.push({ id: 'operation:' + operation.key, conditionKey: 'operation:' + operation.key, category: 'uncertain-operation', severity: 'information',
      title: operation.liveState === 'ambiguous' ? 'Ambiguous operation evidence' : operation.liveState === 'unknown-after-reload' ? 'Operation live state unknown after reload' : 'Completion not observed',
      explanation: `${operation.operation} observation has ${operation.liveState} evidence; it does not establish ongoing execution, a stuck agent or success.`,
      eventIds: [...operation.eventIds], conversations: event?.conversationId ? [event.conversationId] : [], limitations: ['Agent execution is not controlled by acknowledging or muting this item.'], notifyEligible: false });
  }
  const health = manager.health.snapshot();
  if (['degraded', 'disconnected'].includes(health.transport) || health.sourceGapEvents) items.unshift({ id: 'collection-health', conditionKey: 'collection-health', category: 'collection-health', severity: 'medium',
    title: 'Collection coverage needs inspection', explanation: health.status, eventIds: [], conversations: [], limitations: ['Missing telemetry is not proof of agent inactivity.'], notifyEligible: false });
  if (overlap.unqualifiedFileEvents) items.push({ id: 'overlap-unqualified', conditionKey: 'overlap-unqualified', category: 'unqualified-file-evidence', severity: 'information',
    title: 'Physical overlap checks have unqualified inputs', explanation: `${overlap.unqualifiedFileEvents} file observations lack proven conversation attribution or physical file identity. Native source hints remain unqualified.`,
    eventIds: [], conversations: [], limitations: ['No physical conflict is inferred from filenames, source-session participation or watcher timing.'], notifyEligible: false });
  if (overlap.omittedAdvisories || overlap.truncatedFileEvents) items.push({ id: 'overlap-bounds', conditionKey: 'overlap-bounds', category: 'analysis-coverage', severity: 'information', title: 'Overlap analysis is bounded',
    explanation: `${overlap.truncatedFileEvents} file facts and ${overlap.omittedAdvisories} advisories fall outside analysis/display bounds.`, eventIds: [], conversations: [], limitations: ['Absence of an advisory does not establish absence of overlap.'], notifyEligible: false });
  const local = manager.observationStatus();
  if (local.failures || local.dropped || manager.observations.coverageDropped) items.unshift({ id: 'local-observation-gaps', conditionKey: 'local-observation-gaps', category: 'observation-health', severity: 'information', title: 'Local observation gaps',
    explanation: `${local.failures} failures, ${local.dropped} capacity drops and ${manager.observations.coverageDropped} history drops.`, eventIds: [], conversations: [], limitations: ['Filesystem/editor notifications are partial and have unknown actor.'], notifyEligible: false });
  return items.slice(0, 200);
}
export class AttentionTree implements vscode.TreeDataProvider<AttentionItem>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<AttentionItem | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  private items: AttentionItem[] = [];
  update(items: AttentionItem[], frozen: boolean): void { if (!frozen) { this.items = items; this.changed.fire(undefined); } }
  getChildren(): AttentionItem[] { return this.items; }
  getTreeItem(item: AttentionItem): vscode.TreeItem {
    const node = new vscode.TreeItem(item.title);
    node.id = item.id; node.description = `${item.severity}${item.acknowledged ? ' · acknowledged' : ''}${item.muted ? ' · muted' : ''}`;
    node.tooltip = [item.explanation, item.relativePath ? `File: ${item.relativePath}` : 'File: see source evidence or unresolved', `Conversations: ${item.conversations.join(', ') || 'unknown'}`,
      `Trigger events: ${item.eventIds.join(', ') || 'collection metadata only'}`, ...item.limitations].join('\n');
    node.iconPath = new vscode.ThemeIcon(item.muted ? 'bell-slash' : item.acknowledged ? 'check' : item.severity === 'information' ? 'info' : 'warning',
      new vscode.ThemeColor(item.severity === 'information' ? 'descriptionForeground' : 'list.warningForeground'));
    node.contextValue = 'overwatchAttention'; node.accessibilityInformation = { label: `${item.title}, ${node.description}, ${item.explanation}` };
    return node;
  }
  dispose(): void { this.changed.dispose(); }
}
