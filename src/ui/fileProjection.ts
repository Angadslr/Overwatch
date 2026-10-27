import type { EventV1 } from '../core/contracts';
import { identityNamespace, conversationKey } from '../core/identity';
import type { ActivityNode } from './files';

export const RECENT_ACTIVITY_MS = 30000;
export const scopeLabel = (event: EventV1): string => `Workspace ${event.workspaceId.slice(0, 10)} · ${event.environmentId} · Worktree ${event.worktreeId ?? 'unspecified'}`;
export interface FileRow {
  key: string;
  scope: string;
  scopeLabel: string;
  relativePath: string;
  identity: 'source path hint' | 'physical sample' | 'unresolved local path';
  children: ActivityNode[];
  sessions: string[];
  lastReceivedAt: string;
}
/** Uses the exact conversation rows. Display grouping never upgrades a source
 * path hint to physical identity, nor attributes ambient facts to a session. */
export function projectFiles(roots: readonly ActivityNode[]): FileRow[] {
  const files = new Map<string, FileRow>();
  for (const group of roots) for (const node of group.children ?? []) {
    const e = node.observation?.event ?? node.localObservation?.event;
    if (!e || (node.kind !== 'file' && node.kind !== 'local')) continue;
    const relativePath = node.kind === 'file' && node.hint ? node.label : e.targets[0]?.relativePath;
    if (!relativePath || relativePath === 'Unresolved file') continue;
    const localTarget = node.localObservation?.event.targets[0];
    const identity: FileRow['identity'] = node.observation ? 'source path hint' : localTarget?.fileKey ? 'physical sample' : 'unresolved local path';
    const scope = JSON.stringify(identityNamespace(e));
    const key = JSON.stringify([scope, identity, localTarget?.fileKey ?? relativePath]);
    let row = files.get(key);
    if (!row) {
      row = { key, scope, scopeLabel: scopeLabel(e), relativePath, identity, children: [], sessions: [], lastReceivedAt: e.receivedAt };
      files.set(key, row);
    }
    row.children.push(node.observation ? { ...node, description: `${group.label} · ${node.description}` } : node);
    if (e.receivedAt > row.lastReceivedAt) row.lastReceivedAt = e.receivedAt;
    if (node.observation && e.conversationId) {
      const session = conversationKey(e, e.conversationId);
      if (!row.sessions.includes(session)) row.sessions.push(session);
    }
  }
  return [...files.values()].sort((a, b) => a.scope.localeCompare(b.scope) || a.relativePath.localeCompare(b.relativePath) || a.identity.localeCompare(b.identity));
}
export interface ActivityBadge { badge: '!' | 'W' | 'R' | '?'; color: string; description: string }
export function activityBadge(rows: readonly FileRow[], now: number): ActivityBadge | undefined {
  const children = rows.flatMap(r => r.children).filter(n => {
    const event = n.observation?.event ?? n.localObservation?.event;
    return event && Date.parse(event.receivedAt) <= now && now - Date.parse(event.receivedAt) < RECENT_ACTIVITY_MS;
  });
  if (!children.length) return undefined;
  const operations = children.flatMap(n => n.operation ? [n.operation] : []);
  const sessions = new Set(children.flatMap(n => n.observation?.event.conversationId ? [conversationKey(n.observation.event, n.observation.event.conversationId)] : []));
  const suffix = `${sessions.size} recent source sessions · file actor unverified · recent 30s`;
  if (operations.some(o => ['ambiguous', 'completion-not-observed', 'unknown-after-reload'].includes(o.liveState) || o.state === 'failed' || o.state === 'cancelled'))
    return { badge: '!', color: 'list.warningForeground', description: `Attention: incomplete, failed or ambiguous evidence · ${suffix}` };
  if (operations.some(o => o.operation === 'edit' || o.operation === 'delete'))
    return { badge: 'W', color: 'gitDecoration.modifiedResourceForeground', description: `Edit activity reported · save and acceptance unverified · ${suffix}` };
  if (operations.some(o => o.operation === 'read'))
    return { badge: 'R', color: 'gitDecoration.addedResourceForeground', description: `Read activity reported · model use unverified · ${suffix}` };
  return { badge: '?', color: 'descriptionForeground', description: `${operations.length ? 'Uncertain source file activity' : 'Local observation'} · actor unknown · ${suffix}` };
}
/** Returns only affected locators, including removals; stable updates are silent. */
export function changedBadgeKeys(previous: ReadonlyMap<string, string>, next: ReadonlyMap<string, string>): string[] {
  return [...new Set([...previous.keys(), ...next.keys()])].filter(key => previous.get(key) !== next.get(key));
}
