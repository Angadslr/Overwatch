import * as vscode from 'vscode';
import type { OperationActivity, FileObservation } from '../core/reducers';
import type { PluginManager } from '../integration/pluginManager';
import { FixtureTargets } from '../integration/fixtureTargets';
export interface ActivityNode {
  kind: 'session' | 'file' | 'message';
  id: string;
  label: string;
  description: string;
  hint?: string;
  operation?: OperationActivity;
  observation?: FileObservation;
  children?: ActivityNode[];
}
export interface RenderSample {
  eventId: string;
  receivedAt: string;
  treeItemServedAt: string;
  latencyMs: number;
}
export function age(receivedAt: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - Date.parse(receivedAt)) / 1000));
  if (seconds < 60)
    return `${seconds}s ago`;
  if (seconds < 3600)
    return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}
function evidence(operation: OperationActivity): string {
  if (operation.state === 'ambiguous')
    return 'Ambiguous evidence';
  if (operation.state === 'observed' && operation.operation === 'edit')
    return 'Edit reported · save unverified';
  if (operation.state === 'completed')
    return `${operation.operation === 'read' ? 'Read' : 'Tool'} completed · source report`;
  if (operation.state === 'failed')
    return operation.outcome === 'denied' ? 'Action denied · source report' : 'Action failed · source report';
  if (operation.state === 'cancelled')
    return 'Action cancelled · source report';
  return `${operation.operation === 'read' ? 'Read' : 'Edit'} requested · completion unknown`;
}
export class FilesTree implements vscode.TreeDataProvider<ActivityNode>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<ActivityNode | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  readonly samples: RenderSample[] = [];
  private readonly rendered = new Set<string>();
  private readonly timer: NodeJS.Timeout;
  constructor(private readonly manager: PluginManager, private readonly targets: FixtureTargets) {
    this.timer = setInterval(() => this.refresh(), 1000);
    this.timer.unref();
  }
  refresh(): void { this.changed.fire(undefined); }
  getChildren(node?: ActivityNode): ActivityNode[] {
    if (node)
      return node.children ?? [];
    const snapshot = this.manager.store.snapshot();
    const groups = new Map<string, ActivityNode>();
    for (const operation of snapshot.operations) {
      const observation = operation.eventIds.map(id => this.manager.evidence.get(id)).filter((o): o is FileObservation => Boolean(o)).sort((a, b) => b.event.receivedAt.localeCompare(a.event.receivedAt))[0];
      if (!observation)
        continue;
      const event = observation.event;
      const key = JSON.stringify([event.collectorId, event.environmentId, event.workspaceId, event.worktreeId ?? null, event.conversationId ?? null]);
      let group = groups.get(key);
      if (!group) {
        group = { kind: 'session', id: key, label: event.conversationId ? `Source session ${event.conversationId.slice(0, 10)}` : 'Unlinked source activity', description: 'File actor unverified', children: [] };
        groups.set(key, group);
      }
      const hint = observation.pathHint;
      const relative = hint ? this.targets.relativePath(hint) : undefined;
      group.children!.push({ kind: 'file', id: operation.key, label: relative ?? 'Unresolved file', description: `${age(event.receivedAt)} · ${evidence(operation)}`, operation, observation, ...(hint === undefined ? {} : { hint }) });
    }
    if (!groups.size)
      return [{ kind: 'message', id: 'empty', label: this.manager.enabled ? 'Waiting for native read/edit activity' : 'Collection is off', description: 'Invented fixture workspace only' }];
    return [...groups.values()];
  }
  getTreeItem(node: ActivityNode): vscode.TreeItem {
    const item = new vscode.TreeItem(node.label, node.kind === 'session' ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None);
    item.id = node.id;
    item.description = node.description;
    item.iconPath = new vscode.ThemeIcon(node.kind === 'session' ? 'comment-discussion' : node.kind === 'file' ? 'file' : 'info');
    if (node.observation) {
      const e = node.observation.event;
      item.tooltip = [node.label, node.description, `Source session: ${e.conversationId ?? 'unknown'}`, `Generation: ${e.generationId ?? 'unknown'}`, `Evidence: ${node.operation?.state ?? e.phase}`, `Receipt: ${e.receivedAt}`, 'Disk persistence: unknown', 'Acceptance: unknown', 'Child-to-file ownership: unverified'].join('\n');
      if (node.hint && this.targets.relativePath(node.hint))
        item.command = { command: 'overwatch.supervision.openFile', title: 'Open current fixture file', arguments: [node.hint] };
      if (!this.rendered.has(e.eventId)) {
        this.rendered.add(e.eventId);
        while (this.rendered.size > 10000)
          this.rendered.delete(this.rendered.values().next().value!);
        this.samples.push({ eventId: e.eventId, receivedAt: e.receivedAt, treeItemServedAt: new Date().toISOString(), latencyMs: Math.max(0, Date.now() - Date.parse(e.receivedAt)) });
        if (this.samples.length > 100)
          this.samples.shift();
      }
    }
    return item;
  }
  dispose(): void { clearInterval(this.timer); this.changed.dispose(); }
}
