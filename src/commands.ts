import * as vscode from 'vscode';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { probeEligibility } from './host/capabilities';
import { PluginManager } from './integration/pluginManager';
import { FixtureTargets } from './integration/fixtureTargets';
import { FilesTree, type ActivityNode } from './ui/files';
import { SecureDirectory } from './transport/secureFs';
import { ConversationIdentities } from './core/identity';
import { bindFileObservations } from './host/fileObservationBindings';
import { LocalPaths } from './adapters/localPaths';
import { diagnosticObservation, privacyExclusions, permittedPath } from './core/privacy';
import { ByFileTree } from './ui/byFile';
import { ActivityDecorations } from './ui/decorations';
import { ActivityTree, captureActivity } from './ui/activity';
import { ActivityViewState, type ActivityFilters } from './ui/viewState';
import { ActivityDetails, type FileAvailability } from './ui/details';
import { AttentionState, type AttentionItem } from './core/attention';
import {registerMaintenance,type MaintenanceApi}from'./ui/maintenance';
import {atomicPrivateBytes}from'./transport/retention';
import { AttentionTree, attentionCandidates } from './ui/attention';
import { HealthTree } from './ui/health';
import { CollectorHealth } from './core/health';
export interface SupervisionApi {
  manager: PluginManager | undefined;
  tree: FilesTree | undefined;
  files: ByFileTree | undefined;
  decorations: ActivityDecorations | undefined;
  activityTree: ActivityTree | undefined;
  display: ActivityViewState;
  details: ActivityDetails;
  attention: AttentionState;
  attentionTree: AttentionTree;
  healthTree: HealthTree;
  maintenance:MaintenanceApi;
  snapshot: () => {
    enabled: boolean;
    status: string;
    activity: ReturnType<PluginManager['store']['snapshot']> | undefined;
    samples: FilesTree['samples'];
    nodes: ReturnType<FilesTree['getChildren']>;
    lifecycle: ReturnType<PluginManager['lifecycle']['snapshot']> | undefined;
    health: ReturnType<PluginManager['health']['snapshot']> | undefined;
    localObservations: ReturnType<PluginManager['observations']['snapshot']> | undefined;
    localCoverage: ReturnType<PluginManager['observationStatus']> | undefined;
  };
  disable: () => Promise<void>;
}
export async function registerSupervision(context: vscode.ExtensionContext, root: string | undefined, fixture: boolean): Promise<SupervisionApi> {
  let manager: PluginManager | undefined, tree: FilesTree | undefined;
  let files: ByFileTree | undefined, decorations: ActivityDecorations | undefined;
  let activityTree: ActivityTree | undefined;
  let maintenance:MaintenanceApi|undefined;
  const display = new ActivityViewState(), details = new ActivityDetails();
  const attention = new AttentionState(context.workspaceState.get('supervision.attention.v1'));
  const attentionTree = new AttentionTree();
  const config = () => vscode.workspace.getConfiguration('agentSupervision');
  const sourceColumn = (input: unknown): vscode.ViewColumn => typeof input === 'number' && Number.isInteger(input) && input >= 1 && input <= 9 ? input : vscode.ViewColumn.Active;
  let disposed = false;
  let aliasWrite: Promise<void> = Promise.resolve();
  let savedAliasRevision = 0;
  const identities = new ConversationIdentities(context.workspaceState.get('supervision.aliases.v1'));
  function persistAliases(): void {
    if (identities.revision === savedAliasRevision) return;
    const state = identities.aliasState();
    savedAliasRevision = identities.revision;
    aliasWrite = aliasWrite.then(async () => { await context.workspaceState.update('supervision.aliases.v1', state); })
      .catch(() => { savedAliasRevision = -1; output.appendLine('Session aliases could not be saved. Retry before reloading.'); });
  }
  const output = vscode.window.createOutputChannel('Agent Supervision');
  context.subscriptions.push(output);
  const unavailable = () => probeEligibility({ trusted: vscode.workspace.isTrusted, remote: Boolean(vscode.env.remoteName), platform: process.platform, arch: process.arch, fixture, pluginApi: true });
  async function sameWorkspace(): Promise<boolean> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    try {
      return folders.length === 1 && folders[0]?.uri.scheme === 'file' && await realpath(folders[0].uri.fsPath) === root;
    }
    catch {
      return false;
    }
  }
  const forwarded = new vscode.EventEmitter<ActivityNode | undefined>();
  const provider: vscode.TreeDataProvider<ActivityNode> = { onDidChangeTreeData: forwarded.event, getTreeItem: n => tree?.getTreeItem(n) ?? new vscode.TreeItem(n.label), getChildren: n => tree?.getChildren(n) ?? [{ kind: 'message', id: 'unsupported', label: 'Collection unavailable', description: 'Open a trusted local invented fixture workspace' }] };
  const view = vscode.window.createTreeView('overwatch.supervision.files', { treeDataProvider: provider, showCollapseAll: true });
  const fileForwarded = new vscode.EventEmitter<ActivityNode | undefined>();
  const fileProvider: vscode.TreeDataProvider<ActivityNode> = { onDidChangeTreeData: fileForwarded.event,
    getTreeItem: n => files?.getTreeItem(n) ?? new vscode.TreeItem(n.label),
    getChildren: n => files?.getChildren(n) ?? [{ kind: 'message', id: 'files-unavailable', label: 'Collection unavailable', description: 'Open a trusted local invented fixture workspace' }] };
  const fileView = vscode.window.createTreeView('overwatch.supervision.byFile', { treeDataProvider: fileProvider, showCollapseAll: true });
  const activityForwarded = new vscode.EventEmitter<ActivityNode | undefined>();
  const activityView = vscode.window.createTreeView('overwatch.supervision.activity', { treeDataProvider: {
    onDidChangeTreeData: activityForwarded.event, getTreeItem: n => activityTree?.getTreeItem(n) ?? new vscode.TreeItem(n.label), getChildren: n => activityTree?.getChildren(n) ?? [], getParent: () => undefined,
  } });
  const attentionView = vscode.window.createTreeView('overwatch.supervision.attention', { treeDataProvider: attentionTree });
  context.subscriptions.push(attentionTree, attentionView);
  const unavailableHealth = new CollectorHealth(); unavailableHealth.unavailable();
  const healthTree = new HealthTree(() => manager?.readiness() ?? { registered: false, owner: false, supported: false, health: unavailableHealth.snapshot(), check: { state: 'not-run' }, counters: { accepted: 0, rejected: 0, failures: 0 }, recoveredTail: false });
  const healthView = vscode.window.createTreeView('overwatch.supervision.health', { treeDataProvider: healthTree });
  context.subscriptions.push(healthTree, healthView);
  context.subscriptions.push(view, forwarded, fileView, fileForwarded, activityView, activityForwarded, details, { dispose: () => { disposed = true; } });
  if (root && fixture) {
    let collectorId = context.globalState.get<string>('supervision.collectorId');
    if (!collectorId) {
      collectorId = randomUUID();
      await context.globalState.update('supervision.collectorId', collectorId);
    }
    const exclusions = () => vscode.workspace.getConfiguration('agentSupervision').get<unknown>('pathExclusions', []);
    const targets = new FixtureTargets(root, () => manager?.exclusions ?? []);
    const owningFolder = vscode.workspace.workspaceFolders?.[0]?.uri.toString();
    const localEligible = () => !disposed && !unavailable() && vscode.workspace.workspaceFolders?.length === 1 && vscode.workspace.workspaceFolders[0]?.uri.toString() === owningFolder;
    const localCollectorId = collectorId;
    manager = new PluginManager({ root, storage: join(root, '.local', 'supervision-storage'), helper: join(context.extensionPath, 'dist', 'cursor-supervision-hook'), collectorId, identities, eligibility: unavailable,
      exclusions, allowExistingHooks: () => config().get('allowExistingHooks',false), healthChanged: () => { if (!disposed) healthTree.refresh(); }, observeLocal: deliver => bindFileObservations(root, localCollectorId, localEligible, deliver, manager!.exclusions), changed: () => { persistAliases(); if (tree && !disposed) {
        view.message = manager!.status;
        tree.refresh();
      } } });
    tree = new FilesTree(manager, targets, display, () => view.visible || fileView.visible || activityView.visible);
    files = new ByFileTree(tree);
    activityTree = new ActivityTree(display, tree);
    let latestRevealed: string | undefined;
    let displayedHistoryRevision = manager.historyRevision;
    tree.setCapture(clockOnly => {
      if (displayedHistoryRevision !== manager!.historyRevision) { displayedHistoryRevision = manager!.historyRevision; display.reset(); details.clear();latestRevealed=undefined;maintenance?.invalidateExport(); }
      if (clockOnly) {
        display.tick(Date.now());
        const message = `${manager!.status} · ${display.status(manager!.enabled)}`;
        view.message = message; fileView.message = message; activityView.message = message;
        activityTree!.refresh();
        return;
      }
      const roots = tree!.liveRoots();
      display.update(captureActivity(manager!, roots), roots, Date.now());
      const message = `${manager!.status} · ${display.status(manager!.enabled)}`;
      view.message = message; fileView.message = message; activityView.message = message;
      healthTree.refresh();
      const candidates = attentionCandidates(manager!, Date.now());
      if (attention.preferenceInvalid) candidates.unshift({ id: 'attention-preferences-invalid', conditionKey: 'attention-preferences-invalid', category: 'attention-preferences', severity: 'information', title: 'Saved attention controls could not be loaded',
        explanation: 'Default local acknowledge/mute controls were used. Review them before enabling optional notifications.', eventIds: [], conversations: [], limitations: ['Source event history is unchanged.'], notifyEligible: false });
      attention.update(candidates);
      attentionTree.update(attention.snapshot(), display.frozen);
      attentionView.message = display.frozen ? 'Display frozen · collection and optional notifications continue' : `${attention.snapshot().length} attention items · advisories are not confirmed conflicts`;
      for (const item of attention.notifications(manager!.enabled && config().get('notifications', false), Date.now()))
        void Promise.resolve(vscode.window.showWarningMessage(`Agent Supervision: ${item.title}`, 'Inspect')).then(choice => { if (choice === 'Inspect') return vscode.commands.executeCommand('overwatch.supervision.inspectAttention', item.id); return undefined; }).catch(() => {});
      if (!display.frozen) {
        activityTree!.refresh();
        const latest = activityTree!.getChildren().at(-1);
        if (latest?.kind === 'activity' && latest.id !== latestRevealed && activityView.visible && config().get('followLatest', false)) {
          latestRevealed = latest.id;
          void Promise.resolve(activityView.reveal(latest, { focus: false, select: false })).catch(() => {});
        }
      }
    });
    context.subscriptions.push(activityTree, activityTree.onDidChangeTreeData(node => { if (!disposed) activityForwarded.fire(node); }));
    decorations = new ActivityDecorations(root, () => files!.liveRows(), () => manager!.exclusions, () => manager!.enabled);
    context.subscriptions.push(files, files.onDidChangeTreeData(node => { if (!disposed) fileForwarded.fire(node); }), decorations, vscode.window.registerFileDecorationProvider(decorations));
    context.subscriptions.push(tree);
    for (const observedView of [view,fileView,activityView]) context.subscriptions.push(observedView.onDidChangeVisibility(event => { if (event.visible && !disposed) tree?.refresh(true); }));
    const changed = tree.onDidChangeTreeData(node => { if (!disposed) {
      forwarded.fire(node);
    } });
    context.subscriptions.push(changed);
    context.subscriptions.push(vscode.commands.registerCommand('overwatch.supervision.openLocalObservation', async (key: unknown, column?: unknown) => {
      if (!vscode.workspace.isTrusted || typeof key !== 'string' || key.length > 2048 || !await sameWorkspace()) return { ok: false, reason: 'unavailable' };
      const observation = manager!.observations.get(key);
      const relativePath = observation?.event.targets[0]?.relativePath;
      if (!relativePath) return { ok: false, reason: 'unresolved' };
      try {
        if (!permittedPath(relativePath, privacyExclusions(exclusions()))) return { ok: false, reason: 'excluded' };
        const paths = await LocalPaths.create('local-darwin-arm64', [{ path: root }], privacyExclusions(exclusions()));
        if (observation!.event.workspaceId !== paths.roots[0]?.workspaceId) return { ok: false, reason: 'unresolved' };
        const target = await paths.resolve(relativePath);
        if (!target.ok || target.existence !== 'existing' || target.target.pathKind !== 'file') {
          void vscode.window.showInformationMessage('The observed local file is currently missing or unavailable.');
          return { ok: false, reason: 'missing' };
        }
        if (!permittedPath(relativePath, privacyExclusions(exclusions()))) return { ok: false, reason: 'excluded' };
        const document = await vscode.workspace.openTextDocument(vscode.Uri.file(target.path));
        const checked = await paths.resolve(relativePath);
        if (!vscode.workspace.isTrusted || !await sameWorkspace() || !permittedPath(relativePath, privacyExclusions(exclusions())) || !checked.ok || checked.existence !== 'existing' || checked.path !== target.path || checked.target.fileKey !== target.target.fileKey)
          return { ok: false, reason: 'unavailable' };
        await vscode.window.showTextDocument(document, { preview: true, viewColumn: sourceColumn(column) });
        return { ok: true, relativePath: target.relativePath };
      } catch { return { ok: false, reason: 'missing' }; }
    }));
    context.subscriptions.push(vscode.commands.registerCommand('overwatch.supervision.openFile', async (hint: unknown, column?: unknown) => {
      if (!vscode.workspace.isTrusted || typeof hint !== 'string')
        return { ok: false, reason: 'untrusted' };
      if (!await sameWorkspace())
        return { ok: false, reason: 'workspace-changed' };
      const target = await targets.resolve(hint);
      if (!target.ok) {
        void vscode.window.showInformationMessage(target.reason === 'missing' ? 'The observed fixture file is currently missing.' : 'The observed path is unavailable or unsafe to open.');
        return target;
      }
      try {
        const document = await vscode.workspace.openTextDocument(vscode.Uri.file(target.path));
        const checked = await targets.resolve(hint);
        if (!checked.ok)
          return checked;
        await vscode.window.showTextDocument(document, { preview: true, viewColumn: sourceColumn(column) });
        return { ok: true, relativePath: target.relativePath };
      }
      catch {
        void vscode.window.showInformationMessage('The observed fixture file is currently missing or unreadable.');
        return { ok: false, reason: 'missing' };
      }
    }));
    context.subscriptions.push(vscode.commands.registerCommand('overwatch.supervision.inspectActivity', async (key: unknown) => {
      if (disposed || !vscode.workspace.isTrusted || !await sameWorkspace() || typeof key !== 'string' || key.length > 2048) return { ok: false, reason: 'unavailable' };
      const entry = display.find(key); if (!entry) return { ok: false, reason: 'not-displayed' };
      const anchor = details.anchorColumn();
      let availability: FileAvailability = 'unresolved';
      let relativePath: string | undefined;
      try {
        const hint = entry.observation?.pathHint;
        if (hint) {
          const resolved = await targets.resolve(hint);
          availability = resolved.ok ? 'existing' : resolved.reason === 'missing' ? 'missing' : 'unresolved';
          if (resolved.ok) {
            relativePath = resolved.relativePath;
            const opened = await vscode.commands.executeCommand<{ ok: boolean; reason?: string }>('overwatch.supervision.openFile', hint, anchor);
            if (!opened?.ok) availability = opened?.reason === 'missing' ? 'missing' : 'unavailable';
          }
        } else if (entry.localObservation) {
          const path = entry.event.targets[0]?.relativePath;
          if (path && permittedPath(path, privacyExclusions(exclusions()))) {
            const paths = await LocalPaths.create(entry.event.environmentId, [{ path: root }], privacyExclusions(exclusions()));
            const resolved = await paths.resolve(path);
            availability = resolved.ok ? resolved.existence === 'existing' ? 'existing' : 'missing' : 'unresolved';
            if (resolved.ok && resolved.existence === 'existing') {
              relativePath = resolved.relativePath;
              const opened = await vscode.commands.executeCommand<{ ok: boolean; reason?: string }>('overwatch.supervision.openLocalObservation', JSON.stringify([entry.event.collectorId, entry.event.environmentId, entry.event.workspaceId, entry.event.worktreeId ?? null, entry.event.eventId]), anchor);
              if (!opened?.ok) availability = opened?.reason === 'missing' ? 'missing' : 'unavailable';
            }
          } else availability = 'excluded';
        }
        if (!display.find(key) || !vscode.workspace.isTrusted || !await sameWorkspace()) return { ok: false, reason: 'unavailable' };
        await details.show(entry, availability, display.frozen, config().get('detailsBeside', true), anchor);
        return { ok: true, availability, ...(relativePath ? { relativePath } : {}) };
      } catch { return { ok: false, reason: 'unavailable' }; }
    }));
    tree.refresh(true);
  }
  function refreshDisplay(): void { tree?.refresh(true); activityTree?.refresh(); }
  async function togglePreference(name: 'detailsBeside' | 'followLatest', fallback: boolean): Promise<{ ok: true; enabled: boolean }> {
    const enabled = !config().get(name, fallback);
    await config().update(name, enabled, vscode.ConfigurationTarget.Workspace);
    return { ok: true, enabled };
  }
  async function filterActivity(): Promise<void> {
    const facet = await vscode.window.showQuickPick(['Conversation', 'Operation', 'Time', 'Evidence'], { title: 'Filter supervision activity' });
    if (!facet) return;
    let values: Array<{ label: string; value?: string | number }>;
    if (facet === 'Conversation') values = [{ label: 'All conversations' }, ...identities.snapshot().sessions.map(s => ({ label: `${s.alias} · ${s.sourceId.slice(0, 10)}`, value: s.key }))];
    else if (facet === 'Operation') values = [{ label: 'All operations' }, ...['read', 'edit', 'create', 'delete', 'rename', 'search', 'shell', 'mcp', 'lifecycle', 'unknown'].map(value => ({ label: value, value }))];
    else if (facet === 'Time') values = [{ label: 'All retained events' }, { label: 'Last 15 minutes', value: 900000 }, { label: 'Last hour', value: 3600000 }, { label: 'Last 24 hours', value: 86400000 }];
    else values = [{ label: 'All evidence' }, ...['source-reported', 'filesystem-observed', 'buffer-observed', 'self-check', 'ambiguous'].map(value => ({ label: value, value }))];
    const selected = await vscode.window.showQuickPick(values, { title: `${facet} filter` });
    if (!selected) return;
    const key: keyof ActivityFilters = facet === 'Conversation' ? 'conversation' : facet === 'Operation' ? 'operation' : facet === 'Time' ? 'withinMs' : 'evidence';
    const next: Record<string, unknown> = { ...display.activeFilters };
    if (selected.value === undefined) delete next[key]; else next[key] = selected.value;
    display.setFilters(next); refreshDisplay();
  }
  async function selectAttention(input?: AttentionItem | string): Promise<AttentionItem | undefined> {
    if (input) return attention.get(typeof input === 'string' ? input : input.id);
    const selected = await vscode.window.showQuickPick(attention.snapshot().map(item => ({ label: item.title, description: `${item.severity}${item.muted ? ' · muted' : ''}${item.acknowledged ? ' · acknowledged' : ''}`, id: item.id })), { title: 'Select attention item' });
    return selected ? attention.get(selected.id) : undefined;
  }
  context.subscriptions.push(
    vscode.commands.registerCommand('overwatch.supervision.runSelfCheck', async () => {
      if (!manager || !vscode.workspace.isTrusted || !await sameWorkspace()) return { state: 'unsupported' };
      const result = await manager.runSelfCheck();
      output.appendLine(result.state === 'passed' ? 'Helper/spool/collector self-check passed. Native Agent delivery remains a separate check.' : 'Self-check did not pass. Inspect Source Health for the failing layer and next action.');
      healthTree.refresh(); return result;
    }),
    vscode.commands.registerCommand('overwatch.supervision.inspectAttention', async (input: AttentionItem | string) => {
      const item = await selectAttention(input);
      if (!item || disposed || !vscode.workspace.isTrusted || !await sameWorkspace()) return { ok: false };
      const text = [item.title, '', item.explanation, `Severity: ${item.severity}`, `Category: ${item.category}`, `File evidence: ${item.relativePath ?? item.fileIdentity ?? 'unknown'}`,
        `Conversation evidence: ${item.conversations.join(', ') || 'unknown'}`, `Trigger event IDs: ${item.eventIds.join(', ') || 'collection metadata'}`,
        `Acknowledged: ${item.acknowledged}`, `Muted: ${item.muted}`, ...item.limitations, '', 'Acknowledging/muting changes this local attention projection. Event history and agent execution are unchanged.'].join('\n');
      await details.showText(text, config().get('detailsBeside', true), details.anchorColumn()); return { ok: true };
    }),
    ...(['acknowledgeAttention', 'toggleMuteAttention'] as const).map(command => vscode.commands.registerCommand('overwatch.supervision.' + command, async (input: AttentionItem | string) => {
      const item = await selectAttention(input); if (!item) return { ok: false };
      const id = item.id;
      const ok = command === 'acknowledgeAttention' ? attention.acknowledge(id) : attention.toggleMute(id);
      if (!ok) return { ok: false };
      attentionTree.update(attention.snapshot(), false);
      await context.workspaceState.update('supervision.attention.v1', attention.preferences()); return { ok: true };
    })),
    vscode.commands.registerCommand('overwatch.supervision.setActivityFilters', (filters: unknown) => {
      try { display.setFilters(filters); refreshDisplay(); return { ok: true }; } catch { return { ok: false, reason: 'invalid-filters' }; }
    }),
    vscode.commands.registerCommand('overwatch.supervision.filterActivity', filterActivity),
    vscode.commands.registerCommand('overwatch.supervision.clearActivityFilters', () => { display.setFilters({}); refreshDisplay(); return { ok: true }; }),
    vscode.commands.registerCommand('overwatch.supervision.freezeDisplay', () => {
      tree?.refresh(); const frozen = display.toggleFreeze(); refreshDisplay(); return { ok: true, frozen };
    }),
    vscode.commands.registerCommand('overwatch.supervision.toggleDetailsBeside', () => togglePreference('detailsBeside', true)),
    vscode.commands.registerCommand('overwatch.supervision.toggleFollowLatest', () => togglePreference('followLatest', false)),
  );
  async function disable(): Promise<void> { if (manager) {
    await maintenance?.cancelReset();
    await context.workspaceState.update('supervision.collectionRequested', false);
    await manager.disable();
    persistAliases();
    await aliasWrite;
    output.appendLine('Collection disabled. Reload the fixture window to clear cached hook commands.');
  } }
  context.subscriptions.push(vscode.commands.registerCommand('overwatch.supervision.enable', async () => {
    const reason = unavailable();
    if (reason || !manager) {
      output.appendLine('Collection requires a trusted local invented fixture workspace.');
      return { ok: false, reason: reason ?? 'workspace-unavailable' };
    }
    if (!await sameWorkspace())
      return { ok: false, reason: 'workspace-changed' };
    try {
      await manager.enable();
      await context.workspaceState.update('supervision.collectionRequested', true);
      await vscode.commands.executeCommand('overwatch.supervision.files.focus');
      output.appendLine('Collector ready. Native delivery requires an ordinary Agent file action.');
      return { ok: true };
    }
    catch {
      output.appendLine('Enable failed. Existing hooks and collector ownership are preserved.');
      const reason = manager.readiness().ownership === 'other-window' ? 'other-window-owner' : manager.readiness().ownership === 'uncertain' ? 'ownership-uncertain' : 'enable-failed';
      void vscode.window.showInformationMessage(reason === 'other-window-owner' ? 'Another window owns collection for this checkout. This window remains passive.' : 'Could not enable fixture collection. Existing hooks are preserved; inspect Source Health.');
      return { ok: false, reason };
    }
  }), vscode.commands.registerCommand('overwatch.supervision.disable', async () => { await disable(); return { ok: true }; }), vscode.commands.registerCommand('overwatch.supervision.disableAndReload', async () => { await disable(); await vscode.commands.executeCommand('workbench.action.reloadWindow'); }), vscode.commands.registerCommand('overwatch.supervision.refresh', () => { manager?.refresh(); tree?.refresh(); }), vscode.commands.registerCommand('overwatch.supervision.report', async () => {
    if (!root || !fixture || !manager || !tree)
      return { ok: false };
    const activeManager=manager,sourceTree=tree;
    return activeManager.withStorageLease(async guard=>{
    activeManager.refresh();
    const nodes = sourceTree.getChildren().flatMap(n => sourceTree.getChildren(n)).slice(0, 100);
    const lifecycle = activeManager.lifecycle.snapshot();
    const report = { recordedAt: new Date().toISOString(), nativeDelivery: 'requires-manual-action-trace', enabled: activeManager.enabled, status: activeManager.status, cleanup: activeManager.lastCleanup,
      readiness: activeManager.readiness(),
      display: { frozen: display.frozen, matchingEvents: display.entries().length, incomingEvents: display.pending, filterFacets: Object.keys(display.activeFilters) },
      health: activeManager.health.snapshot(), lifecycle: { conversations: lifecycle.conversations.slice(-100), turns: lifecycle.turns.slice(-100), coverageDropped: lifecycle.coverageDropped },
      localCoverage: activeManager.observationStatus(), localObservations: activeManager.observations.snapshot().records.slice(-100).map(diagnosticObservation),
      evidenceCount: activeManager.evidence.size, renderSamples: sourceTree.samples.slice(-100), entries: nodes.map(n => ({ kind: n.kind, sourceSessionId: n.observation?.event.conversationId, eventId: n.observation?.event.eventId, receivedAt: n.observation?.event.receivedAt, phase: n.operation?.state })) };
    const directory = await SecureDirectory.open(join(root, '.local', 'supervision-storage'));
    try {await atomicPrivateBytes(directory,'view-report.json',Buffer.from(JSON.stringify(report,null,2)+'\n'),guard);}finally{await directory.close();}
    output.appendLine('Metadata-only collection report saved in fixture storage.');
    return { ok: true };
    });
  }), vscode.workspace.onDidChangeConfiguration(event => {
    if (event.affectsConfiguration('agentSupervision.pathExclusions')) { display.reset(); details.clear();maintenance?.invalidateExport(); void Promise.all([context.workspaceState.update('supervision.collectionRequested',false),manager?.restrictPrivacy(config().get('pathExclusions', [])),maintenance?.cancelReset()]).catch(() => output.appendLine('Privacy change cleanup could not complete.')); }
  }), vscode.workspace.onDidChangeWorkspaceFolders(() => { display.reset(); details.clear(); void disable().catch(() => output.appendLine('Collection cleanup could not complete.')); }));
  maintenance=registerMaintenance(context,root,manager,{disable,workspaceReady:async()=>!unavailable()&&await sameWorkspace(),afterReset:async()=>{display.setFilters({});display.reset();details.clear();attention.clearHistory();attentionTree.update([],false);await context.workspaceState.update('supervision.attention.v1',attention.preferences());persistAliases();await aliasWrite;tree?.refresh(true);}});
  if (manager && context.workspaceState.get('supervision.collectionRequested', false) && !unavailable() && await sameWorkspace()) {
    try { await manager.enable(); output.appendLine('Previously enabled fixture collection resumed. Native delivery is not yet verified.'); }
    catch { output.appendLine('Collection could not resume. Inspect Source Health; existing hooks and active ownership are preserved.'); }
  }
  return { manager, tree, files, decorations, activityTree, display, details, attention, attentionTree, healthTree, maintenance,snapshot: () => ({ enabled: manager?.enabled ?? false, status: manager?.status ?? 'Collection unavailable', activity: manager?.store.snapshot(), samples: tree?.samples ?? [], nodes: tree?.getChildren() ?? [], lifecycle: manager?.lifecycle.snapshot(), health: manager?.health.snapshot(), localObservations: manager?.observations.snapshot(), localCoverage: manager?.observationStatus() }), disable };
}
