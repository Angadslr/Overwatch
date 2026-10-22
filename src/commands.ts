import * as vscode from 'vscode';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { realpath, open, rename, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { probeEligibility } from './host/capabilities';
import { PluginManager } from './integration/pluginManager';
import { FixtureTargets } from './integration/fixtureTargets';
import { FilesTree, type ActivityNode } from './ui/files';
import { SecureDirectory } from './transport/secureFs';
export interface SupervisionApi {
  manager: PluginManager | undefined;
  tree: FilesTree | undefined;
  snapshot: () => {
    enabled: boolean;
    status: string;
    activity: ReturnType<PluginManager['store']['snapshot']> | undefined;
    samples: FilesTree['samples'];
    nodes: ReturnType<FilesTree['getChildren']>;
  };
  disable: () => Promise<void>;
}
export async function registerSupervision(context: vscode.ExtensionContext, root: string | undefined, fixture: boolean): Promise<SupervisionApi> {
  let manager: PluginManager | undefined, tree: FilesTree | undefined;
  let disposed = false;
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
  context.subscriptions.push(view, forwarded, { dispose: () => { disposed = true; } });
  if (root && fixture) {
    let collectorId = context.globalState.get<string>('supervision.collectorId');
    if (!collectorId) {
      collectorId = randomUUID();
      await context.globalState.update('supervision.collectorId', collectorId);
    }
    const targets = new FixtureTargets(root);
    manager = new PluginManager({ root, storage: join(root, '.local', 'supervision-storage'), helper: join(context.extensionPath, 'dist', 'cursor-supervision-hook'), collectorId, eligibility: unavailable, changed: () => { if (tree && !disposed) {
        view.message = manager!.status;
        tree.refresh();
      } } });
    tree = new FilesTree(manager, targets);
    context.subscriptions.push(tree);
    const changed = tree.onDidChangeTreeData(node => { if (!disposed) {
      view.message = manager!.status;
      forwarded.fire(node);
    } });
    context.subscriptions.push(changed);
    context.subscriptions.push(vscode.commands.registerCommand('overwatch.supervision.openFile', async (hint: unknown) => {
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
        await vscode.window.showTextDocument(document, { preview: true });
        return { ok: true, relativePath: target.relativePath };
      }
      catch {
        void vscode.window.showInformationMessage('The observed fixture file is currently missing or unreadable.');
        return { ok: false, reason: 'missing' };
      }
    }));
  }
  async function disable(): Promise<void> { if (manager) {
    await manager.disable();
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
      await vscode.commands.executeCommand('overwatch.supervision.files.focus');
      output.appendLine('Collector ready. Native delivery requires an ordinary Agent file action.');
      return { ok: true };
    }
    catch {
      output.appendLine('Enable failed. Existing hooks and collector ownership are preserved.');
      void vscode.window.showInformationMessage('Could not enable fixture collection. Check for existing hooks or another collector.');
      return { ok: false, reason: 'enable-failed' };
    }
  }), vscode.commands.registerCommand('overwatch.supervision.disable', async () => { await disable(); return { ok: true }; }), vscode.commands.registerCommand('overwatch.supervision.disableAndReload', async () => { await disable(); await vscode.commands.executeCommand('workbench.action.reloadWindow'); }), vscode.commands.registerCommand('overwatch.supervision.refresh', () => { manager?.refresh(); tree?.refresh(); }), vscode.commands.registerCommand('overwatch.supervision.report', async () => {
    if (!root || !fixture || !manager || !tree)
      return { ok: false };
    manager.refresh();
    const nodes = tree.getChildren().flatMap(n => tree!.getChildren(n)).slice(0, 100);
    const report = { recordedAt: new Date().toISOString(), nativeDelivery: 'requires-manual-action-trace', enabled: manager.enabled, status: manager.status, cleanup: manager.lastCleanup,
      evidenceCount: manager.evidence.size, renderSamples: tree.samples.slice(-100), entries: nodes.map(n => ({ relativePath: n.label, evidence: n.description, sourceSessionId: n.observation?.event.conversationId, eventId: n.observation?.event.eventId, receivedAt: n.observation?.event.receivedAt })) };
    const directory = await SecureDirectory.open(join(root, '.local', 'supervision-storage'));
    const temporary = join(directory.path, `report-${randomUUID()}.tmp`);
    try {
      const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try {
        await file.writeFile(JSON.stringify(report, null, 2) + '\n');
        await file.sync();
      }
      finally {
        await file.close();
      }
      await directory.guard();
      await rename(temporary, join(directory.path, 'view-report.json'));
      await directory.sync();
    }
    finally {
      await unlink(temporary).catch(() => { });
      await directory.close();
    }
    output.appendLine('Metadata-only collection report saved in fixture storage.');
    return { ok: true };
  }), vscode.workspace.onDidChangeWorkspaceFolders(() => { void disable().catch(() => output.appendLine('Collection cleanup could not complete.')); }));
  return { manager, tree, snapshot: () => ({ enabled: manager?.enabled ?? false, status: manager?.status ?? 'Collection unavailable', activity: manager?.store.snapshot(), samples: tree?.samples ?? [], nodes: tree?.getChildren() ?? [] }), disable };
}
