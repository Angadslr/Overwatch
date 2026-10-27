import * as vscode from 'vscode';
import { realpath } from 'node:fs/promises';
import { getPluginApi } from './host/capabilities';
import { isFixture } from './integration/probe';
import { registerSupervision, type SupervisionApi } from './commands';

let supervision: SupervisionApi | undefined;
export async function activate(context: vscode.ExtensionContext): Promise<SupervisionApi> {
  const roots = vscode.workspace.workspaceFolders ?? [];
  const root = roots.length === 1 && roots[0]?.uri.scheme === 'file' ? await realpath(roots[0].uri.fsPath) : undefined;
  const fixture = root ? await isFixture(root) : false;
  supervision = await registerSupervision(context, root, fixture);
  // Historical discovery commands now use the sole policy-enforced collector.
  for (const name of ['enable', 'enableProjectHooks', 'disable', 'disableAndReload']) {
    context.subscriptions.push(vscode.commands.registerCommand('overwatch.probe.' + name, () =>
      vscode.commands.executeCommand('overwatch.supervision.' + (name === 'enableProjectHooks' ? 'enable' : name))));
  }
  context.subscriptions.push(vscode.commands.registerCommand('overwatch.probe.report', async () => {
    const report = { recordedAt: new Date().toISOString(), editorApiVersion: vscode.version, extensionHostNode: process.versions.node,
      platform: process.platform, architecture: process.arch, trusted: vscode.workspace.isTrusted, remote: Boolean(vscode.env.remoteName),
      fixture, pluginApiAvailable: Boolean(getPluginApi(vscode)), legacyDiscoveryCapture: 'retired', privacyVersion: 1 };
    const document = await vscode.workspace.openTextDocument({ language: 'json', content: JSON.stringify(report, null, 2) });
    await vscode.window.showTextDocument(document, { preview: true });
  }));
  return supervision;
}
export async function deactivate(): Promise<void> {
  await supervision?.maintenance.cancelReset();
  // Host shutdown preserves the user's enable choice; the explicit Disable command clears it.
  await supervision?.manager?.disable(); supervision = undefined;
}
