import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import type { ActivityEntry } from './viewState';

export type FileAvailability = 'existing' | 'missing' | 'unresolved' | 'excluded' | 'unavailable';
export function activityDetails(entry: ActivityEntry, availability: FileAvailability, frozen: boolean): string {
  const e = entry.event;
  const line = (name: string, value: unknown): string => `${name}: ${value === undefined ? 'unknown' : JSON.stringify(value)}`;
  return ['Agent Supervision — activity details', '',
    frozen ? 'Display frozen. Collection continues; file availability below is checked at selection time.' : 'Historical observation; file availability is checked at selection time.',
    line('File label', entry.label), line('Current file availability', availability), line('Source', e.source), line('Source event', e.sourceEvent), line('Source version', e.sourceVersion),
    line('Event ID', e.eventId), line('Operation ID', e.operationId), line('Source call ID', e.sourceCallId), line('Operation', e.operation),
    line('Observation phase', e.phase), line('Observation outcome', e.outcome), line('Received at', e.receivedAt), line('Source occurred at', e.sourceOccurredAt), line('Journal sequence', e.ingestSequence),
    line('Collector', e.collectorId), line('Environment', e.environmentId), line('Workspace', e.workspaceId), line('Worktree', e.worktreeId),
    line('Session alias', entry.sessionLabel), line('Source conversation', e.conversationId), line('Generation', e.generationId), line('Actor scope', e.actorScope), line('Proven actor', e.actorId),
    line('Activity evidence', e.evidence.activity), line('Attribution evidence', e.evidence.attribution), line('Completion evidence', e.evidence.completion),
    line('Disk persistence evidence', e.evidence.diskPersistence), line('Correlation evidence', e.evidence.correlation), line('Limitations', e.evidence.limitations),
    line('File targets', e.targets), line('Source path hint', entry.observation?.pathHint),
    ...(entry.localObservation ? [line('Local observation kind', entry.localObservation.kind), line('Presence sampled at original observation', entry.localObservation.currentPresence)] : []),
    ...(entry.operation ? ['', 'Operation aggregate across retained facts (may include events outside active filters):', line('State', entry.operation.state), line('Live state', entry.operation.liveState),
      line('Event IDs', entry.operation.eventIds), line('Missing start', entry.operation.missingStart), line('Missing completion', entry.operation.missingCompletion)] : []),
    '', 'Model use: unknown', 'Saved byte version: unknown', 'Human acceptance: unknown', 'Child-to-file ownership: unverified',
    'This document contains metadata only. Opening it does not prove an agent read, write, save or acceptance.', ''].join('\n');
}
/** One bounded read-only document; payloads cannot choose a URI or command. */
export class ActivityDetails implements vscode.TextDocumentContentProvider, vscode.Disposable {
  readonly uri = vscode.Uri.from({ scheme: 'overwatch-supervision-details', authority: randomUUID(), path: '/Activity details.txt' });
  private readonly changed = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.changed.event;
  private text = 'Select an activity to inspect its evidence.\n';
  private anchor = vscode.ViewColumn.One;
  private column: vscode.ViewColumn | undefined;
  private revision = 0;
  private disposed = false;
  private readonly registration: vscode.Disposable;
  constructor() { this.registration = vscode.workspace.registerTextDocumentContentProvider(this.uri.scheme, this); }
  provideTextDocumentContent(): string { return this.text; }
  anchorColumn(): vscode.ViewColumn {
    const editor = vscode.window.activeTextEditor;
    return editor && editor.document.uri.scheme !== this.uri.scheme ? editor.viewColumn ?? vscode.ViewColumn.One : this.anchor;
  }
  async show(entry: ActivityEntry, availability: FileAvailability, frozen: boolean, beside: boolean, anchor: vscode.ViewColumn): Promise<void> {
    await this.showText(activityDetails(entry, availability, frozen), beside, anchor);
  }
  async showText(text: string, beside: boolean, anchor: vscode.ViewColumn): Promise<void> {
    if (this.disposed) return;
    const revision = ++this.revision;
    this.anchor = anchor;
    const column = beside ? Math.min(anchor + 1, 9) : anchor;
    const misplaced = vscode.window.tabGroups.all.filter(g => g.viewColumn !== column).flatMap(g => g.tabs.filter(t => t.input instanceof vscode.TabInputText && t.input.uri.toString() === this.uri.toString()));
    if (misplaced.length) await vscode.window.tabGroups.close(misplaced, true);
    if (this.disposed || revision !== this.revision) return;
    this.text = text; this.changed.fire(this.uri);
    const document = await vscode.workspace.openTextDocument(this.uri);
    if (this.disposed || revision !== this.revision) return;
    const editor = await vscode.window.showTextDocument(document, { viewColumn: column, preserveFocus: true, preview: true });
    this.column = editor.viewColumn;
  }
  clear(): void { this.revision++; this.text = 'Activity details unavailable. Select a currently eligible activity.\n'; this.changed.fire(this.uri); }
  snapshot(): { uri: string; text: string; column: vscode.ViewColumn | undefined } { return { uri: this.uri.toString(), text: this.text, column: this.column }; }
  dispose(): void { this.disposed = true; this.clear(); this.registration.dispose(); this.changed.dispose(); }
}
