import * as vscode from 'vscode';
import { join, relative } from 'node:path';
import { LocalPaths } from '../adapters/localPaths';
import { permittedPath } from '../core/privacy';
import { activityBadge, changedBadgeKeys, type FileRow } from './fileProjection';

/** Batched at 5Hz; filesystem checks precede decoration publication. */
export class ActivityDecorations implements vscode.FileDecorationProvider, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<vscode.Uri[]>();
  readonly onDidChangeFileDecorations = this.changed.event;
  private readonly badges = new Map<string, vscode.FileDecoration>();
  private signatures = new Map<string, string>();
  private readonly timer: NodeJS.Timeout;
  private pending = false;
  private disposed = false;
  private fingerprint = '';
  private cachedInput: {rows:FileRow[];exclusions:string;enabled:boolean;expiresAt:number}|undefined;
  constructor(private readonly root: string, private readonly rows: () => FileRow[], private readonly exclusions: () => readonly string[], private readonly enabled: () => boolean) {
    this.timer = setInterval(() => { void this.refresh(); }, 200); this.timer.unref();
  }
  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    return uri.scheme === 'file' && this.enabled() && permittedPath(relative(this.root, uri.fsPath), this.exclusions()) ? this.badges.get(uri.toString()) : undefined;
  }
  async refresh(now = Date.now()): Promise<void> {
    if (this.pending || this.disposed) return;
    this.pending = true;
    try {
      const enabled = this.enabled(), exclusions = JSON.stringify(this.exclusions());
      const source = enabled ? this.rows() : undefined;
      if (this.cachedInput && this.cachedInput.rows === source && this.cachedInput.exclusions === exclusions && this.cachedInput.enabled === enabled && now < this.cachedInput.expiresAt) return;
      const candidates = new Map<string, FileRow[]>();
      let expiresAt = Infinity;
      if (source) for (const row of source) {
        const rows = candidates.get(row.relativePath) ?? []; rows.push(row); candidates.set(row.relativePath, rows);
        for (const child of row.children) {
          const event = child.observation?.event ?? child.localObservation?.event;
          if (event) { const received = Date.parse(event.receivedAt), expiry = received > now ? received : received + 30000; if (expiry > now) expiresAt = Math.min(expiresAt, expiry); }
        }
      }
      const next = new Map<string, vscode.FileDecoration>(), signatures = new Map<string, string>();
      const fingerprint = JSON.stringify([this.enabled(), exclusions, [...candidates].map(([path, rows]) => [path, activityBadge(rows, now), rows.map(r => r.children.map(n => n.id))])]);
      this.cachedInput = source ? {rows:source,exclusions,enabled,expiresAt} : undefined;
      if (fingerprint === this.fingerprint) return;
      const paths = candidates.size ? await LocalPaths.create('local-darwin-arm64', [{ path: this.root }], this.exclusions()) : undefined;
      for (const [relative, rows] of candidates) {
        const badge = activityBadge(rows, now); if (!badge) continue;
        const checked = await paths!.resolve(relative);
        if (!checked.ok || checked.existence !== 'existing') continue;
        const key = vscode.Uri.file(join(this.root, relative)).toString();
        next.set(key, new vscode.FileDecoration(badge.badge, badge.description, new vscode.ThemeColor(badge.color)));
        signatures.set(key, JSON.stringify(badge));
      }
      if (this.disposed) return;
      if (!this.enabled() || exclusions !== JSON.stringify(this.exclusions())) { next.clear(); signatures.clear(); }
      const affected = changedBadgeKeys(this.signatures, signatures);
      this.badges.clear(); for (const [key, badge] of next) this.badges.set(key, badge);
      this.signatures = signatures;
      this.fingerprint = fingerprint;
      if (affected.length) this.changed.fire(affected.map(key => vscode.Uri.parse(key)));
    } catch {
      this.cachedInput = undefined;
      const affected = [...this.badges.keys()]; this.badges.clear(); this.signatures.clear();
      if (!this.disposed && affected.length) this.changed.fire(affected.map(key => vscode.Uri.parse(key)));
    } finally { this.pending = false; }
  }
  dispose(): void {
    this.disposed = true; clearInterval(this.timer);
    const affected = [...this.badges.keys()]; this.badges.clear(); this.signatures.clear();
    if (affected.length) this.changed.fire(affected.map(key => vscode.Uri.parse(key))); this.changed.dispose();
  }
}
