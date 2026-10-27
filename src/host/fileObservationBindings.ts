import * as vscode from 'vscode';
import { LocalPaths } from '../adapters/localPaths';
import { FileObservations, type LocalObserverHandle } from '../adapters/fileObservations';
import type { LocalObservation } from '../core/reducers';
/** Only copies allowlisted metadata; deliberately has no editor-open listener. */
export async function bindFileObservations(root: string, collectorId: string, eligible: () => boolean, deliver: (observation: LocalObservation) => void, exclusions: readonly string[] = []): Promise<LocalObserverHandle> {
  const paths = await LocalPaths.create('local-darwin-arm64', [{ path: root }], exclusions);
  const observer = new FileObservations({ root, collectorId, paths, eligible, deliver });
  const subscriptions: vscode.Disposable[] = [];
  const changedVersions = new Map<string, {
    version: number;
    dirty: boolean;
  }>();
  try {
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root, '**/*'));
    subscriptions.push(watcher, watcher.onDidCreate(uri => { if (uri.scheme === 'file')
      observer.enqueue({ path: uri.fsPath, kind: 'disk-create' }); }), watcher.onDidChange(uri => { if (uri.scheme === 'file')
      observer.enqueue({ path: uri.fsPath, kind: 'disk-change' }); }), watcher.onDidDelete(uri => { if (uri.scheme === 'file')
      observer.enqueue({ path: uri.fsPath, kind: 'disk-delete' }); }), vscode.workspace.onDidChangeTextDocument(event => {
      if (event.document.uri.scheme !== 'file')
        return;
      const path = event.document.uri.fsPath, version = event.document.version, dirty = event.document.isDirty;
      if (event.contentChanges.length > 0) {
        if (observer.enqueue({ path, kind: 'buffer-change', dirty })) {
          changedVersions.delete(path);
          changedVersions.set(path, { version, dirty });
          if (changedVersions.size > 256) {
            changedVersions.delete(changedVersions.keys().next().value!);
            observer.noteDrop();
          }
        }
      }
      else {
        // Cursor may publish the text change before its separate dirty-state update.
        const previous = changedVersions.get(path);
        if (previous?.version === version && dirty && !previous.dirty) {
          observer.enqueue({ path, kind: 'buffer-change', dirty: true });
          previous.dirty = true;
        }
      }
    }), vscode.workspace.onDidSaveTextDocument(document => {
      if (document.uri.scheme === 'file') {
        changedVersions.delete(document.uri.fsPath);
        observer.enqueue({ path: document.uri.fsPath, kind: 'buffer-save' });
      }
    }), vscode.workspace.onDidCloseTextDocument(document => { if (document.uri.scheme === 'file')
      changedVersions.delete(document.uri.fsPath); }));
  }
  catch {
    observer.dispose();
    changedVersions.clear();
    for (const subscription of subscriptions) {
      try {
        subscription.dispose();
      }
      catch {
        observer.noteFailure();
      }
    }
    throw new Error('local-observer-unavailable');
  }
  let disposed = false;
  return { snapshot: () => observer.snapshot(), whenIdle: () => observer.whenIdle(), dispose: () => {
      if (disposed)
        return;
      disposed = true;
      observer.dispose();
      changedVersions.clear();
      for (const subscription of subscriptions) {
        try {
          subscription.dispose();
        }
        catch {
          observer.noteFailure();
        }
      }
    } };
}
