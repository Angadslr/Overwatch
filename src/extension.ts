import * as vscode from 'vscode';
import { mkdir, writeFile, readdir, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { getPluginApi, probeEligibility } from './host/capabilities';
import { isFixture, NativeProbe, ProjectHookProbe } from './integration/probe';
import { createTimingRecorder } from './integration/probeTiming';

declare const __PROBE_NODE__: string;
let activeProbe: NativeProbe | undefined;
let projectProbe: ProjectHookProbe | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const output = vscode.window.createOutputChannel('Overwatch Native Probe');
  context.subscriptions.push(output);
  const roots = vscode.workspace.workspaceFolders ?? [];
  const root = roots.length === 1 && roots[0]?.uri.scheme === 'file' ? await realpath(roots[0].uri.fsPath) : undefined;
  const fixture = root ? await isFixture(root) : false;
  const api = getPluginApi(vscode);
  const storage = fixture && root ? join(root, '.local', 'probe-storage') : undefined;
  if (storage && root) {
    const record = createTimingRecorder(storage, root);
    context.subscriptions.push(
      vscode.workspace.onDidOpenTextDocument(document => record('open', document)),
      vscode.workspace.onDidChangeTextDocument(event => record('change', event.document)),
      vscode.workspace.onDidSaveTextDocument(document => record('save', document)),
      vscode.workspace.onDidCloseTextDocument(document => record('close', document)),
    );
  }
  const report: Record<string, unknown> = {
    recordedAt: new Date().toISOString(), extensionVersion: context.extension.packageJSON.version,
    extensionMode: context.extensionMode === vscode.ExtensionMode.Production ? 'production' : context.extensionMode === vscode.ExtensionMode.Development ? 'development' : 'test',
    editorApiVersion: vscode.version,
    cursorVersion: (vscode as unknown as { cursorVersion?: string }).cursorVersion ?? 'unknown',
    platform: process.platform, architecture: process.arch, extensionHostNode: process.versions.node,
    trusted: vscode.workspace.isTrusted, remote: vscode.env.remoteName ?? null,
    fixture, pluginApiAvailable: Boolean(api), registration: 'not-attempted',
    nativeDelivery: 'not-verified',
  };

  async function saveReport(): Promise<void> {
    if (!storage) return;
    await mkdir(storage, { recursive: true, mode: 0o700 });
    report.recordedAt = new Date().toISOString();
    report.nativeProbeFiles = (await readdir(join(storage, 'inbox')).catch(() => [])).filter(name => /^[0-9a-f-]{36}\.json$/.test(name)).length;
    await writeFile(join(storage, 'compatibility.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
  }

  async function enable(): Promise<void> {
    const reason = probeEligibility({ trusted: vscode.workspace.isTrusted, remote: Boolean(vscode.env.remoteName), platform: process.platform, arch: process.arch, fixture, pluginApi: Boolean(api) });
    if (reason || !storage || !root || !api) {
      report.registration = reason ?? 'workspace-unavailable';
      await saveReport();
      output.appendLine(`Probe unavailable: ${report.registration}`);
      return;
    }
    try {
      activeProbe ??= new NativeProbe(api);
      await activeProbe.enable(storage, root, __PROBE_NODE__, join(context.extensionPath, 'dist', 'probe-hook.cjs'));
      report.registration = 'registerPath-returned';
      await saveReport();
      output.appendLine('Plugin path registered. Native delivery remains unverified until a fixture action emits a hook.');
    } catch {
      report.registration = 'registration-failed';
      await saveReport();
      output.appendLine('Plugin registration failed; raw exception omitted.');
    }
  }

  async function disable(): Promise<void> {
    try {
      const removed = activeProbe?.disable() ?? false;
      report.projectHookCleanup = await projectProbe?.disable() ?? 'not-installed';
      if (report.projectHookCleanup === 'removed') report.projectHookRegistration = 'removed';
      report.projectHookCache = report.projectHookCleanup === 'removed' ? 'window-reload-required' : 'not-applicable';
      report.registration = removed ? 'unregisterPath-returned' : report.registration;
      await saveReport();
      output.appendLine('Collection disabled. Reload this fixture window to clear Cursor\'s cached project hooks, then verify no new invocation.');
    } catch {
      report.registration = 'unregistration-failed';
      await saveReport();
      output.appendLine('Unregistration failed; close the development window before continuing.');
    }
  }

  async function enableProjectHooks(): Promise<void> {
    const reason = probeEligibility({ trusted: vscode.workspace.isTrusted, remote: Boolean(vscode.env.remoteName), platform: process.platform, arch: process.arch, fixture, pluginApi: true });
    if (reason || !storage || !root) { output.appendLine(`Project hook probe unavailable: ${reason}`); return; }
    try {
      projectProbe ??= new ProjectHookProbe();
      await projectProbe.enable(storage, root, __PROBE_NODE__, join(context.extensionPath, 'dist', 'probe-hook.cjs'));
      report.projectHookRegistration = 'exclusive-fixture-config-created';
      await saveReport();
      output.appendLine('Project hooks created in the invented fixture only. Native delivery is not yet verified.');
    } catch {
      report.projectHookRegistration = 'creation-failed-existing-config-preserved';
      await saveReport();
      output.appendLine('Could not create project probe hooks. Existing configuration is preserved.');
    }
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('overwatch.probe.enable', enable),
    vscode.commands.registerCommand('overwatch.probe.disable', disable),
    vscode.commands.registerCommand('overwatch.probe.disableAndReload', async () => {
      await disable();
      if (report.projectHookCleanup === 'removed') await vscode.commands.executeCommand('workbench.action.reloadWindow');
    }),
    vscode.commands.registerCommand('overwatch.probe.enableProjectHooks', enableProjectHooks),
    vscode.commands.registerCommand('overwatch.probe.report', async () => {
      await saveReport();
      const document = await vscode.workspace.openTextDocument({ language: 'json', content: JSON.stringify(report, null, 2) });
      await vscode.window.showTextDocument(document, { preview: true });
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => { void disable(); }),
    { dispose: () => { activeProbe?.disable(); } },
  );
  await saveReport();
  if (process.env.OVERWATCH_PROBE_AUTOSTART === '1') await enable();
}

export async function deactivate(): Promise<void> {
  activeProbe?.disable(); activeProbe = undefined;
  await projectProbe?.disable(); projectProbe = undefined;
}
