import * as vscode from 'vscode';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { SupervisionApi } from '../../src/commands';

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(predicate: () => boolean, stage = 't12-observation'): Promise<void> {
  const deadline = Date.now() + 10000;
  while (!predicate() && Date.now() < deadline) await pause(25);
  if (!predicate()) throw new Error(stage);
}

export async function verifyLocalObservations(api: SupervisionApi, root: string): Promise<string[]> {
  assert.ok(api.manager && api.tree);
  const manager = api.manager, tree = api.tree;
  const records = () => manager.observations.snapshot().records;
  const checks: string[] = [];
  assert.equal(manager.observationStatus().state, 'watching');
  assert.equal(manager.observationStatus().coverage, 'partial');
  const path = join(root, 'observer-sample.txt'), uri = vscode.Uri.file(path);
  // Watch registration is asynchronous and has no activation acknowledgment.
  await pause(500);
  await writeFile(path, 'Invented local observation fixture.\n');
  await waitFor(() => records().some(r => r.event.targets[0]?.relativePath === 'observer-sample.txt' && r.event.source === 'filesystem'), 't12-disk-create');
  const agentCount = manager.store.snapshot().operations.length;
  const document = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(document, { preview: true }); await pause(150);
  assert.equal(manager.store.snapshot().operations.length, agentCount);
  assert.equal(records().some(r => r.event.source === 'editor-buffer' && r.event.targets[0]?.relativePath === 'observer-sample.txt'), false);
  checks.push('opening an editor resource creates neither an agent read nor a buffer-change claim');

  const secret = 'INVENTED_T12_BUFFER_SECRET_NEVER_IN_METADATA';
  const edit = new vscode.WorkspaceEdit(); edit.insert(uri, new vscode.Position(0, 0), secret + '\n');
  assert.equal(await vscode.workspace.applyEdit(edit), true); assert.equal(document.isDirty, true);
  await waitFor(() => records().some(r => r.kind === 'buffer-dirty' && r.event.targets[0]?.relativePath === 'observer-sample.txt'), 't12-buffer-dirty');
  assert.equal((await readFile(path, 'utf8')).includes(secret), false);
  assert.equal(records().some(r => r.kind === 'editor-save' && r.event.targets[0]?.relativePath === 'observer-sample.txt'), false);
  const saveBaseline = records().length; assert.equal(await document.save(), true);
  await waitFor(() => records().slice(saveBaseline).some(r => r.kind === 'editor-save'), 't12-editor-save');
  await waitFor(() => records().slice(saveBaseline).some(r => r.event.source === 'filesystem'), 't12-disk-after-save');
  assert.equal(document.isDirty, false);
  checks.push('unsaved buffer edits, editor saves and disk notifications remain distinct facts');

  const formatter = vscode.languages.registerDocumentFormattingEditProvider({ scheme: 'file', pattern: new vscode.RelativePattern(root, 'observer-sample.txt') }, {
    provideDocumentFormattingEdits: () => [vscode.TextEdit.insert(new vscode.Position(0, 0), 'Invented formatter prefix.\n')],
  });
  try {
    const baseline = records().length;
    const formatted = await vscode.commands.executeCommand<vscode.TextEdit[]>('vscode.executeFormatDocumentProvider', uri, { tabSize: 2, insertSpaces: true });
    assert.ok(formatted?.length); const formatEdit = new vscode.WorkspaceEdit(); formatEdit.set(uri, formatted);
    assert.equal(await vscode.workspace.applyEdit(formatEdit), true);
    await waitFor(() => records().slice(baseline).some(r => r.kind === 'buffer-dirty'), 't12-formatter');
    assert.equal(await document.save(), true);
  } finally { formatter.dispose(); }
  await pause(250); const rewriteBaseline = records().length;
  await writeFile(path, 'Invented independent external rewrite.\n');
  await waitFor(() => records().slice(rewriteBaseline).some(r => r.event.source === 'filesystem' && r.event.targets[0]?.relativePath === 'observer-sample.txt'), 't12-external-rewrite');
  assert.ok(records().every(r => r.event.actorScope === 'unknown' && r.event.conversationId === undefined && r.event.actorId === undefined));
  checks.push('formatter edits and independent disk rewrites keep unknown actor without recent-agent attribution');

  const names = Array.from({ length: 5 }, (_, i) => `observer-burst-${i}.txt`);
  await Promise.all(names.map(name => writeFile(join(root, name), 'Invented burst file.\n')));
  await waitFor(() => names.every(name => records().some(r => r.event.targets[0]?.relativePath === name && r.event.source === 'filesystem')), 't12-burst-create');
  await Promise.all(names.map(name => rm(join(root, name))));
  await waitFor(() => names.every(name => records().some(r => r.event.targets[0]?.relativePath === name && r.kind === 'disk-delete-notification')), 't12-burst-delete');
  assert.ok(records().every(r => r.event.operation === 'unknown' && r.event.outcome === 'unknown'));
  assert.ok(manager.observationStatus().limitations.some(s => s.includes('missed')));
  checks.push('create/delete bursts produce qualified notifications and disclose partial watcher coverage');

  await writeFile(join(root, '.env'), secret);
  await mkdir(join(root, '.local'), { recursive: true }); await writeFile(join(root, '.local', 'observer-hidden.txt'), secret);
  const excludedUri = vscode.Uri.file(join(root, '.env')); const excludedDoc = await vscode.workspace.openTextDocument(excludedUri);
  const excludedEdit = new vscode.WorkspaceEdit(); excludedEdit.insert(excludedUri, new vscode.Position(0, 0), secret);
  assert.equal(await vscode.workspace.applyEdit(excludedEdit), true); assert.equal(await excludedDoc.save(), true); await pause(300);
  assert.equal(records().some(r => r.event.targets.some(target => target.relativePath?.startsWith('.env') || target.relativePath?.startsWith('.local/'))), false);
  assert.equal(JSON.stringify(api.snapshot()).includes(secret), false);
  checks.push('excluded disk/buffer paths and invented content markers never enter observation metadata');

  const group = tree.getChildren().find(n => n.kind === 'local-group'); assert.ok(group);
  const node = tree.getChildren(group).find(n => n.label === 'observer-sample.txt' && n.localObservation); assert.ok(node);
  const item = tree.getTreeItem(node); assert.ok(String(item.description).includes('actor unknown')); assert.ok(item.command);
  const opened = await vscode.commands.executeCommand<{ ok: boolean }>(item.command.command, ...(item.command.arguments ?? []));
  assert.equal(opened?.ok, true); assert.equal(vscode.window.activeTextEditor?.document.uri.fsPath, path);
  assert.equal(manager.store.snapshot().operations.length, agentCount); assert.equal(manager.health.snapshot().nativeDelivery, 'awaiting-first-event');
  checks.push('local observation TreeItems open the current file without proving native delivery');
  return checks;
}

export async function verifyLocalObservationDisposal(api: SupervisionApi, root: string): Promise<string> {
  assert.ok(api.manager); const manager = api.manager;
  assert.equal(manager.observationStatus().state, 'off'); assert.equal(manager.observationStatus().queued, 0);
  const before = manager.observations.revision;
  const path = join(root, 'observer-after-disable.txt'); await writeFile(path, 'Invented disabled fixture.\n');
  const uri = vscode.Uri.file(path), document = await vscode.workspace.openTextDocument(uri);
  const edit = new vscode.WorkspaceEdit(); edit.insert(uri, new vscode.Position(0, 0), 'Invented disabled buffer.\n');
  assert.equal(await vscode.workspace.applyEdit(edit), true); assert.equal(await document.save(), true); await pause(400);
  assert.equal(manager.observations.revision, before); assert.equal(manager.observationStatus().state, 'off');
  return 'disable disposes disk and buffer subscriptions and stops further observation delivery';
}
