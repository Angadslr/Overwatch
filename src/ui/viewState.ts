import type { EventV1 } from '../core/contracts';
import { conversationKey, identityNamespace } from '../core/identity';
import type { ActivityNode } from './files';
import type { FileObservation, LocalObservation, OperationActivity } from '../core/reducers';

export type EvidenceFilter = EventV1['evidence']['activity'] | 'ambiguous';
export interface ActivityFilters {
  conversation?: string;
  operation?: EventV1['operation'];
  withinMs?: number;
  evidence?: EvidenceFilter;
}
export interface ActivityEntry {
  key: string;
  event: EventV1;
  label: string;
  sessionLabel?: string;
  observation?: FileObservation;
  localObservation?: LocalObservation;
  operation?: OperationActivity;
}
export const activityKey = (event: EventV1): string => JSON.stringify([...identityNamespace(event), event.eventId]);
export const DISPLAY_LIMIT = 5000;
export function matchesActivity(entry: ActivityEntry, filters: ActivityFilters, now: number): boolean {
  const e = entry.event;
  return (!filters.conversation || (e.conversationId !== undefined && conversationKey(e, e.conversationId) === filters.conversation)) &&
    (!filters.operation || e.operation === filters.operation) &&
    (!filters.evidence || (filters.evidence === 'ambiguous' ? e.evidence.correlation === 'ambiguous' || entry.operation?.state === 'ambiguous' : e.evidence.activity === filters.evidence)) &&
    (filters.withinMs === undefined || (Date.parse(e.receivedAt) <= now && now - Date.parse(e.receivedAt) <= filters.withinMs));
}
export function checkedFilters(input: unknown): ActivityFilters {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('invalid-activity-filters');
  const f = input as ActivityFilters;
  if (Object.keys(f).some(k => !['conversation', 'operation', 'withinMs', 'evidence'].includes(k)) ||
    (f.conversation !== undefined && (typeof f.conversation !== 'string' || f.conversation.length === 0 || f.conversation.length > 2048)) ||
    (f.operation !== undefined && !['read', 'edit', 'create', 'delete', 'rename', 'search', 'shell', 'mcp', 'lifecycle', 'unknown'].includes(f.operation)) ||
    (f.evidence !== undefined && !['source-reported', 'filesystem-observed', 'buffer-observed', 'self-check', 'ambiguous'].includes(f.evidence)) ||
    (f.withinMs !== undefined && (!Number.isSafeInteger(f.withinMs) || f.withinMs < 1 || f.withinMs > 86400000))) throw new Error('invalid-activity-filters');
  return { ...(f.conversation === undefined ? {} : { conversation: f.conversation }), ...(f.operation === undefined ? {} : { operation: f.operation }),
    ...(f.withinMs === undefined ? {} : { withinMs: f.withinMs }), ...(f.evidence === undefined ? {} : { evidence: f.evidence }) };
}
interface Frame { entries: ActivityEntry[]; roots: ActivityNode[]; at: number; omitted: number }
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Freezes presentation only. The collector never reads this state. */
export class ActivityViewState {
  private live: Frame = { entries: [], roots: [], at: 0, omitted: 0 };
  private held: Frame | undefined;
  private previous = new Set<string>();
  private filters: ActivityFilters = {};
  private projection: {frame: Frame; filters: ActivityFilters; at: number; entries: ActivityEntry[]; roots?: ActivityNode[]} | undefined;
  pending = 0;
  resumed = 0;
  get frozen(): boolean { return this.held !== undefined; }
  get at(): number { return this.frame.at; }
  get activeFilters(): ActivityFilters { return { ...this.filters }; }
  private get frame(): Frame { return this.held ?? this.live; }
  tick(now: number): boolean {
    const previous = !this.frozen && this.filters.withinMs !== undefined ? this.entries() : undefined;
    this.live.at = now;
    if (!previous) return false;
    const next = this.entries();
    return previous.length !== next.length || previous.some((entry, index) => entry.key !== next[index]?.key);
  }
  update(entries: ActivityEntry[], roots: ActivityNode[], now: number): void {
    this.projection = undefined;
    if (this.frozen) this.pending += entries.filter(e => !this.previous.has(e.key)).length;
    this.previous = new Set(entries.map(e => e.key));
    const ordered = [...entries].sort((a, b) => a.event.receivedAt.localeCompare(b.event.receivedAt) || a.key.localeCompare(b.key));
    this.live = { entries: ordered.slice(-DISPLAY_LIMIT), roots, at: now, omitted: Math.max(0, ordered.length - DISPLAY_LIMIT) };
  }
  setFilters(input: unknown): void { const filters = checkedFilters(input);this.projection = undefined;this.filters = filters; }
  toggleFreeze(): boolean {
    this.projection = undefined;
    if (this.held) { this.held = undefined; this.resumed = this.pending; this.pending = 0; }
    else { this.held = clone(this.live); this.pending = 0; this.resumed = 0; }
    return this.frozen;
  }
  reset(): void {
    this.projection = undefined;
    this.live = { entries: [], roots: [], at: 0, omitted: 0 }; this.held = undefined;
    this.previous.clear(); this.pending = 0; this.resumed = 0;
  }
  private matching(): NonNullable<ActivityViewState['projection']> {
    const frame = this.frame, previous = this.projection;
    if (previous?.frame === frame && previous.filters === this.filters && (this.filters.withinMs === undefined || previous.at === frame.at)) return previous;
    return this.projection = {frame, filters: this.filters, at: frame.at, entries: frame.entries.filter(e => matchesActivity(e, this.filters, frame.at))};
  }
  entries(): ActivityEntry[] { return this.matching().entries; }
  find(key: string): ActivityEntry | undefined { return this.entries().find(e => e.key === key); }
  roots(): ActivityNode[] {
    const projection = this.matching();
    if (projection.roots) return projection.roots;
    const entries = projection.entries;
    const matched = new Map(entries.map(e => [activityKey(e.event), e]));
    const byOperation = new Map<string, ActivityEntry[]>();
    const conversations = new Set<string>();
    for (const entry of entries) {
      if (entry.operation) {
        const related = byOperation.get(entry.operation.key) ?? []; related.push(entry); byOperation.set(entry.operation.key, related);
      }
      if (entry.event.conversationId) conversations.add(conversationKey(entry.event, entry.event.conversationId));
    }
    const active = Object.keys(this.filters).length > 0;
    const roots: ActivityNode[] = [];
    for (const group of this.frame.roots) {
      const children: ActivityNode[] = [];
      for (const node of group.children ?? []) {
        if (node.operation) {
          const related = byOperation.get(node.operation.key) ?? [];
          const latest = related.at(-1);
          if (latest) {
            const { hint: previousHint, ...base } = node;
            children.push({ ...base, label: latest.label, ...(latest.observation ? { observation: latest.observation } : {}),
              ...(latest.observation?.pathHint ? { hint: latest.observation.pathHint } : {}),
              ...(active ? { description: `${node.description} · matched ${latest.event.phase} at ${latest.event.receivedAt}` } : {}) });
          }
        } else if (node.localObservation) {
          if (matched.has(activityKey(node.localObservation.event))) children.push(node);
        } else if (!active && node.kind === 'child') children.push(node);
      }
      if (children.length || (group.kind === 'session' && (!active || conversations.has(group.id)))) {
        const operations = children.filter(n => n.operation).length;
        roots.push({ ...group, description: group.kind === 'session'
          ? group.description.replace(/\d+ source operations$/, `${operations} source operations`)
          : `${children.filter(n => n.localObservation).length} matching local observations · coverage partial`, children });
      }
    }
    return projection.roots = roots.length ? roots : [{ kind: 'message', id: 'display-empty', label: 'No matching activity', description: active ? 'Clear filters to show retained events' : 'Enable collection or wait for source/local observations' }];
  }
  status(collecting = true): string {
    const count = this.entries().length;
    const filters = Object.entries(this.filters).map(([key, value]) => key === 'conversation' ? 'conversation selected' : `${key}: ${value}`).join(' · ');
    return [this.frozen ? `Display frozen · ${collecting ? 'collection continues' : 'collection is off'} · ${this.pending} incoming events · Explorer remains live when collecting` : this.resumed ? `Display live · resumed with ${this.resumed} incoming events` : 'Display live',
      `${count} matching events`, filters, this.frame.omitted ? `${this.frame.omitted} older events outside the ${DISPLAY_LIMIT}-event display window` : ''].filter(Boolean).join(' · ');
  }
}
