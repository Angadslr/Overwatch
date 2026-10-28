import * as vscode from 'vscode';
import { localObservationKey, type OperationActivity, type FileObservation, type LocalObservation } from '../core/reducers';
import type { PluginManager } from '../integration/pluginManager';
import { FixtureTargets } from '../integration/fixtureTargets';
import { conversationKey } from '../core/identity';
import { conversationNodes } from './conversations';
import { scopeLabel } from './fileProjection';
import { activityKey, type ActivityViewState } from './viewState';
import {visibleDetailRows, VIEW_PAGE_ROWS} from './paging';
export interface ActivityNode {
  kind: 'session' | 'file' | 'message' | 'child' | 'tool' | 'local-group' | 'local' | 'root' | 'file-group' | 'activity' | 'activity-page';
  id: string;
  label: string;
  description: string;
  hint?: string;
  operation?: OperationActivity;
  observation?: FileObservation;
  children?: ActivityNode[];
  tooltip?: string;
  localObservation?: LocalObservation;
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
  if (operation.liveState === 'unknown-after-reload') return 'Live state unknown after reload';
  if (operation.liveState === 'completion-not-observed') return 'Completion not observed';
  const label = { read: 'Read', edit: 'Edit', search: 'Search', delete: 'Delete', shell: 'Shell', mcp: 'MCP' }[operation.operation as 'read' | 'edit' | 'search' | 'delete' | 'shell' | 'mcp'] ?? 'Tool';
  return operation.hasStart ? `${label} ${operation.state === 'started' ? 'start reported' : 'requested'} · completion unknown` : `${label} observation · outcome unknown`;
}
export class FilesTree implements vscode.TreeDataProvider<ActivityNode>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<ActivityNode | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  readonly samples: RenderSample[] = [];
  private readonly rendered = new Set<string>();
  private readonly timer: NodeJS.Timeout;
  private capture: ((clockOnly?:boolean) => void) | undefined;
  private cachedRoots:{expiresAt:number;roots:ActivityNode[]}|undefined;
  private lastClockRefresh = Date.now();
  private sessionCount = 0;
  get clockRefreshMs(): number { return this.manager.evidence.size > VIEW_PAGE_ROWS ? 60000 : 10000; }
  constructor(private readonly manager: PluginManager, private readonly targets: FixtureTargets, readonly display?: ActivityViewState, private readonly visible:()=>boolean = ()=>true) {
    this.timer = setInterval(() => {
      const timeFilterChanged = this.display?.tick(Date.now()) ?? false;
      if (!this.cachedRoots || Date.now() >= this.cachedRoots.expiresAt) this.refresh();
      else if (timeFilterChanged || (this.visible() && Date.now() - this.lastClockRefresh >= this.clockRefreshMs)) {
        this.lastClockRefresh = Date.now(); this.capture?.(true);
        if (!this.display?.frozen) this.changed.fire(undefined);
      }
    }, 1000);
    this.timer.unref();
  }
  setCapture(capture: (clockOnly?:boolean) => void): void { this.capture = capture; }
  refresh(force = false): void { this.lastClockRefresh=Date.now();this.cachedRoots=undefined;this.capture?.(); if (force || !this.display?.frozen) this.changed.fire(undefined); }
  getChildren(node?: ActivityNode): ActivityNode[] {
    if (node)
      return visibleDetailRows(node.children ?? []);
    return this.display ? this.display.roots() : this.liveRoots();
  }
  liveRoots(): ActivityNode[] {
    const now = Date.now(); if(this.cachedRoots)return this.cachedRoots.roots;
    const snapshot = this.manager.store.viewSnapshot();
    let expiresAt = Infinity;
    for (const operation of snapshot.operations) if (operation.liveState === 'recent-request') {
      for (const id of operation.eventIds) {
        const event = this.manager.evidence.get(id)?.event;
        if (event && ['requested','started'].includes(event.phase)) {
          const expiry = Date.parse(event.receivedAt) + 30000;
          if (expiry > now) expiresAt = Math.min(expiresAt, expiry);
        }
      }
    }
    const groups = new Map<string, ActivityNode>();
    for (const session of conversationNodes(this.manager.identities, this.manager.lifecycle.snapshot())) {
      groups.set(session.key, { kind: 'session', id: session.key, label: session.label, description: session.description, tooltip: session.tooltip,
        children: session.children.map(c => ({ kind: 'child', id: `${session.key}:${c.key}`, label: c.label, description: c.description, tooltip: c.tooltip })) });
    }
    for (const operation of snapshot.operations) {
      const observation = operation.eventIds.map(id => this.manager.evidence.get(id)).filter((o): o is FileObservation => Boolean(o)).sort((a, b) => b.event.receivedAt.localeCompare(a.event.receivedAt))[0];
      if (!observation)
        continue;
      const event = observation.event;
      const key = event.conversationId ? conversationKey(event, event.conversationId) : JSON.stringify([operation.key, 'unlinked']);
      let group = groups.get(key);
      if (!group) {
        group = { kind: 'session', id: key, label: event.conversationId ? `Source session ${event.conversationId.slice(0, 10)}` : 'Unlinked source activity', description: 'File actor unverified', children: [] };
        groups.set(key, group);
      }
      const hint = observation.pathHint;
      const relative = hint ? this.targets.relativePath(hint) : undefined;
      const fileOperation = ['read', 'edit', 'delete', 'search'].includes(operation.operation);
      group.children!.push({ kind: fileOperation ? 'file' : 'tool', id: operation.key, label: relative ?? (fileOperation ? 'Unresolved file' : operation.operation === 'shell' ? 'Shell tool' : 'MCP tool'), description: `${age(operation.lastReceivedAt)} · ${evidence(operation)}`, operation, observation, ...(hint === undefined ? {} : { hint }) });
    }
    for (const group of groups.values()) {
      const operations = group.children?.filter(n => n.operation) ?? [];
      const first = operations[0]?.observation?.event;
      group.description += ` · ${operations.length} source operations`;
      if (first) group.tooltip = [group.tooltip, scopeLabel(first)].filter(Boolean).join('\n');
    }
    const roots: ActivityNode[] = [...groups.values()];
    this.sessionCount = groups.size;
    if (!roots.length) roots.push({ kind: 'message', id: 'empty', label: this.manager.enabled ? 'Waiting for native read/edit activity' : 'Collection is off', description: 'Invented fixture workspace only' });
    const local = this.manager.observations.snapshot(), coverage = this.manager.observationStatus();
    const labels: Record<LocalObservation['kind'], string> = {
      'disk-create-notification': 'Disk create notification', 'disk-change-notification': 'Disk change notification', 'disk-delete-notification': 'Disk delete notification',
      'buffer-dirty': 'Buffer changed · unsaved', 'buffer-change': 'Buffer changed · dirty state unverified', 'editor-save': 'Editor save reported',
    };
    const localChildren: ActivityNode[] = local.records.map(observation => ({ kind: 'local', id: 'local:' + localObservationKey(observation.event),
      label: observation.event.targets[0]?.relativePath ?? 'Unresolved local file', description: `${age(observation.event.receivedAt)} · ${labels[observation.kind]} · actor unknown`, localObservation: observation,
      tooltip: [labels[observation.kind], 'Actor: unknown', `Current path sample at processing: ${observation.currentPresence}`, `Receipt: ${observation.event.receivedAt}`,
        `Notifications represented: ${observation.event.metrics?.count ?? 1}`, 'Disk bytes and human acceptance: unverified', 'No agent operation or causal attribution is inferred.'].join('\n') }));
    if (!localChildren.length) localChildren.push({ kind: 'message', id: 'local-empty', label: 'No local changes observed', description: 'Opening a file does not count as an agent read' });
    if (coverage.dropped || coverage.failures || local.coverageDropped) localChildren.unshift({ kind: 'message', id: 'local-gaps', label: 'Local observation gaps', description: `${coverage.dropped} capacity gaps · ${coverage.failures} failures · ${local.coverageDropped} history drops` });
    roots.push({ kind: 'local-group', id: 'local-observations', label: 'Local file observations', description: `${local.records.length} observations · ${coverage.state} · coverage partial`, children: localChildren,
      tooltip: [coverage.scope, ...coverage.limitations, `Excluded notifications: ${coverage.excluded}`, `Coalesced notifications: ${coverage.coalesced}`].join('\n') });
    this.cachedRoots={expiresAt,roots};return roots;
  }
  getTreeItem(node: ActivityNode): vscode.TreeItem {
    const collapsed = (node.children?.length ?? 0) > VIEW_PAGE_ROWS || (node.kind === 'session' && this.sessionCount > 2 && !this.display?.activeFilters.conversation);
    const item = new vscode.TreeItem(node.label, node.children ? collapsed ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None);
    item.id = node.id;
    const receivedAt = node.observation?.event.receivedAt ?? node.localObservation?.event.receivedAt;
    const description = receivedAt ? node.description.replace(/\b\d+[smh] ago\b/,age(receivedAt,this.display?.at ?? Date.now())) : node.description;
    item.description = description;
    item.accessibilityInformation = { label: `${node.label}, ${description}` };
    if (node.tooltip) item.tooltip = node.tooltip;
    if (node.localObservation) item.command = { command: 'overwatch.supervision.openLocalObservation', title: 'Open current observed file', arguments: [localObservationKey(node.localObservation.event)] };
    item.iconPath = new vscode.ThemeIcon(node.kind === 'session' ? 'comment-discussion' : node.kind === 'root' ? 'root-folder' : node.kind === 'file-group' ? 'file-directory' : node.kind === 'file' ? 'file' : node.kind === 'tool' ? 'terminal' : 'info');
    if (node.observation) {
      const e = node.observation.event;
      item.tooltip = [node.label, description, scopeLabel(e), `Source session: ${e.conversationId ?? 'unknown'}`, `Generation: ${e.generationId ?? 'unknown'}`, `Evidence: ${node.operation?.state ?? e.phase}`, `Live state: ${node.operation?.liveState ?? 'unknown'}`, `Missing start: ${node.operation?.missingStart ?? false}`, `Receipt: ${e.receivedAt}`, 'Disk persistence: unknown', 'Acceptance: unknown', 'Child-to-file ownership: unverified'].join('\n');
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
    const event = node.observation?.event ?? node.localObservation?.event;
    if (this.display && event) item.command = { command: 'overwatch.supervision.inspectActivity', title: 'Inspect activity and current file', arguments: [activityKey(event)] };
    return item;
  }
  dispose(): void { clearInterval(this.timer); this.changed.dispose(); }
}
