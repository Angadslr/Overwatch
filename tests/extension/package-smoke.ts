import * as vscode from 'vscode';
import assert from 'node:assert/strict';
import {readFile, writeFile, access, readdir} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import type {SupervisionApi} from '../../src/commands';

export async function run(): Promise<void> {
  const resultPath = process.env.OVERWATCH_PACKAGE_SMOKE_RESULT;
  if (!resultPath) throw new Error('Missing smoke result path');
  const checks: string[] = [];let api: SupervisionApi | undefined, passed = false;
  try {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    assert.ok(root);assert.equal(vscode.workspace.isTrusted, true);
    const extension = vscode.extensions.getExtension<SupervisionApi>('angad-local.overwatch-native-probe');
    assert.ok(extension);assert.equal(extension.packageJSON.version, '0.0.4');
    assert.ok(extension.extensionPath.startsWith(process.env.OVERWATCH_PACKAGE_EXTENSIONS! + '/'));
    await access(join(extension.extensionPath, 'dist/cursor-supervision-hook'), constants.X_OK);
    checks.push('private candidate is installed outside the source checkout with executable helper');
    api = await extension.activate();
    assert.equal((await vscode.commands.executeCommand<{ok: boolean}>('overwatch.supervision.enable'))?.ok, true);
    assert.equal((await api.manager!.runSelfCheck()).state, 'passed');
    checks.push('installed candidate enables and passes diagnostic helper/collector self-check');
    const storage = join(root, '.local/supervision-storage');
    const hooks = JSON.parse(await readFile(join(root, '.cursor/hooks.json'), 'utf8')).hooks;
    async function invoke(hook: string) {
      const command = hooks[hook].at(-1).command;
      assert.ok(command.includes(extension!.extensionPath));
      return new Promise<void>((done, reject) => {
        const child = spawn('/bin/sh', ['-c', command], {stdio: ['pipe', 'pipe', 'pipe']});
        let stdout = '', stderr = '';
        const timeout = setTimeout(() => {child.kill('SIGKILL');reject(new Error('Helper deadline'));}, 3000);
        child.on('error', reject);child.stdout.on('data', bytes => {stdout += bytes;});child.stderr.on('data', bytes => {stderr += bytes;});
        child.on('close', code => {clearTimeout(timeout);try {assert.equal(code, 0);assert.equal(stderr, '');assert.equal(stdout, hook === 'beforeReadFile' ? '{"permission":"allow"}\n' : '{}\n');done();}catch (error) {reject(error);}});
        child.stdin.on('error', () => {});
        child.stdin.end(JSON.stringify({hook_event_name: hook, cursor_version: '3.26.16', workspace_roots: [root], conversation_id: 'candidate-smoke', generation_id: 'turn', tool_use_id: 'read', file_path: join(root!, hook === 'beforeReadFile' ? 'read.txt' : 'edit.txt')}));
      });
    }
    await invoke('beforeReadFile');await invoke('afterFileEdit');
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && ![...api.manager!.evidence.values()].some(observation => observation.event.sourceEvent === 'afterFileEdit')) await new Promise(resolve => setTimeout(resolve, 25));
    const events = [...api.manager!.evidence.values()].map(observation => observation.event);
    assert.ok(events.some(event => event.sourceEvent === 'beforeReadFile'));assert.ok(events.some(event => event.sourceEvent === 'afterFileEdit'));
    assert.ok(events.every(event => event.evidence.attribution === 'unknown'));
    checks.push('synthetic read/edit inputs traverse installed launchers into evidence with unknown attribution');
    await api.disable();
    assert.equal(JSON.parse(await readFile(join(storage, 'publisher.json'), 'utf8')).enabled, false);
    await assert.rejects(access(join(root, '.cursor/hooks.json')));await assert.rejects(access(join(storage, 'collector.lock')));
    const inbox = await readdir(join(storage, 'inbox'));assert.equal(inbox.length, 1);
    assert.deepEqual(await readdir(join(storage, 'inbox', inbox[0]!)), []);
    checks.push('disable stops publisher, removes owned hooks/lease and leaves current inbox empty');
    passed = true;
  } finally {
    await api?.disable();
    await writeFile(resultPath, JSON.stringify({recordedAt: new Date().toISOString(), passed, nativeAgentDelivery: false, editorApiVersion: vscode.version, node: process.versions.node, checks,
      limitations: ['Separate development test driver exercises the installed target extension bytes.', 'Synthetic hook input and diagnostic self-check do not establish ordinary native Agent delivery or resource qualification.']}, null, 2) + '\n');
  }
}
