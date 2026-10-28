import * as vscode from 'vscode';
import { age, type ActivityNode, type FilesTree } from './files';
import type { PluginManager } from '../integration/pluginManager';
import { activityKey, ActivityViewState, type ActivityEntry } from './viewState';
import { conversationKey } from '../core/identity';
import {chronologicalPages, VIEW_PAGE_ROWS} from './paging';

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
  private readonly pages = new Map<string, {node: ActivityNode; entries: ActivityEntry[]}>();
  private readonly parents = new Map<string, ActivityNode>();
  constructor(readonly state: ActivityViewState, private readonly conversations: FilesTree) {}
  refresh(): void { this.pages.clear();this.parents.clear();this.changed.fire(undefined); }
  getParent(node: ActivityNode): ActivityNode | undefined { return this.parents.get(node.id); }
  getChildren(node?: ActivityNode): ActivityNode[] {
    if (node) return this.nodes(this.pages.get(node.id)?.entries ?? []);
    const entries = this.state.entries();
    this.pages.clear();this.parents.clear();
    if (entries.length > VIEW_PAGE_ROWS) return chronologicalPages(entries).map((page, index) => {
      const node: ActivityNode = {kind: 'activity-page', id: 'activity-page:' + page[0]!.key, label: `Events ${index * VIEW_PAGE_ROWS + 1}–${index * VIEW_PAGE_ROWS + page.length}`,
        description: `${page.length} chronological events${index === Math.ceil(entries.length / VIEW_PAGE_ROWS) - 1 ? ' · latest' : ''}`};
      this.pages.set(node.id, {node, entries: page});for (const entry of page) this.parents.set(entry.key, node);
      return node;
    });
    return entries.length ? this.nodes(entries) : [{ kind: 'message', id: 'activity-empty', label: 'No matching activity', description: 'Clear filters to show retained events' }];
  }
  latestNode(): ActivityNode | undefined {
    const last = this.getChildren().at(-1);
    return last?.kind === 'activity-page' ? this.getChildren(last).at(-1) : last;
  }
  private nodes(entries: ActivityEntry[]): ActivityNode[] {
    return entries.map(entry => ({ kind: 'activity', id: entry.key, label: entry.label,
      description: `${entry.sessionLabel ?? 'Actor unknown'} · ${age(entry.event.receivedAt, this.state.at)} · ${entry.event.sourceEvent} · ${entry.event.phase} · ${entry.event.evidence.activity}`,
      ...(entry.observation ? { observation: entry.observation } : {}), ...(entry.localObservation ? { localObservation: entry.localObservation } : {}),
      ...(entry.operation ? { operation: entry.operation } : {}) }));
  }
  getTreeItem(node: ActivityNode): vscode.TreeItem {
    if (node.kind === 'activity-page') {
      // Expansion is a user choice. Auto-expanding each new "latest" page
      // leaves every older page expanded in Cursor's retained expansion state.
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Collapsed);
      item.id = node.id;item.description = node.description;return item;
    }
    const item = this.conversations.getTreeItem(node);
    if (node.kind === 'activity') item.command = { command: 'overwatch.supervision.inspectActivity', title: 'Inspect activity and current file', arguments: [node.id] };
    return item;
  }
  dispose(): void { this.pages.clear();this.parents.clear();this.changed.dispose(); }
}
