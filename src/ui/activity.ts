import * as vscode from 'vscode';
import { age, type ActivityNode, type FilesTree } from './files';
import type { PluginManager } from '../integration/pluginManager';
import { activityKey, ActivityViewState, type ActivityEntry } from './viewState';
import { conversationKey } from '../core/identity';

export function captureActivity(manager: PluginManager, roots: ActivityNode[]): ActivityEntry[] {
  const operations = new Map(roots.flatMap(g=>(g.children??[]).flatMap(n=>n.operation?n.operation.eventIds.map(id=>[id,n.operation!] as const):[])));
  const labels = new Map(roots.flatMap(g => (g.children ?? []).flatMap(n => n.operation ? n.operation.eventIds.map(id => [id, n.label] as const) : [])));
  const aliases = new Map(manager.identities.snapshot().sessions.map(s => [s.key, s.alias]));
  const entries: ActivityEntry[] = [...manager.evidence.values()].map(observation => ({ key: activityKey(observation.event), event: observation.event,
    label: labels.get(observation.event.eventId) ?? observation.event.sourceEvent, observation,
    ...(observation.event.conversationId ? { sessionLabel: aliases.get(conversationKey(observation.event, observation.event.conversationId)) ?? 'Unlinked source session' } : {}),
    ...(operations.get(observation.event.eventId) ? { operation: operations.get(observation.event.eventId)! } : {}) }));
  for (const localObservation of manager.observations.snapshot().records) entries.push({ key: activityKey(localObservation.event), event: localObservation.event,
    label: localObservation.event.targets[0]?.relativePath ?? 'Unresolved local file', localObservation });
  return entries;
}
export class ActivityTree implements vscode.TreeDataProvider<ActivityNode>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<ActivityNode | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  constructor(readonly state: ActivityViewState, private readonly conversations: FilesTree) {}
  refresh(): void { this.changed.fire(undefined); }
  getParent(): undefined { return undefined; }
  getChildren(node?: ActivityNode): ActivityNode[] {
    if (node) return [];
    const entries = this.state.entries();
    return entries.length ? entries.map(entry => ({ kind: 'activity', id: entry.key, label: entry.label,
      description: `${entry.sessionLabel ?? 'Actor unknown'} · ${age(entry.event.receivedAt, this.state.at)} · ${entry.event.sourceEvent} · ${entry.event.phase} · ${entry.event.evidence.activity}`,
      ...(entry.observation ? { observation: entry.observation } : {}), ...(entry.localObservation ? { localObservation: entry.localObservation } : {}),
      ...(entry.operation ? { operation: entry.operation } : {}) })) : [{ kind: 'message', id: 'activity-empty', label: 'No matching activity', description: 'Clear filters to show retained events' }];
  }
  getTreeItem(node: ActivityNode): vscode.TreeItem {
    const item = this.conversations.getTreeItem(node);
    if (node.kind === 'activity') item.command = { command: 'overwatch.supervision.inspectActivity', title: 'Inspect activity and current file', arguments: [node.id] };
    return item;
  }
  dispose(): void { this.changed.dispose(); }
}
