import type { OverlapAdvisory } from './overlap';
export interface AttentionCandidate {
  id: string; conditionKey: string; category: string; severity: 'high' | 'medium' | 'information'; title: string; explanation: string;
  eventIds: string[]; conversations: string[]; fileIdentity?: string; relativePath?: string; limitations: string[]; notifyEligible: boolean;
}
export interface AttentionItem extends AttentionCandidate { acknowledged: boolean; muted: boolean }
export interface AttentionPreferences { version: 1; acknowledged: string[]; muted: string[] }
export const fromOverlap = (advisory: OverlapAdvisory): AttentionCandidate => ({ ...advisory, title: advisory.category === 'concurrent-edits' ? 'Concurrent edit activity'
  : advisory.category === 'recent-edits' ? 'Recent edits by multiple conversations' : 'Possible stale context', notifyEligible: advisory.severity !== 'information' });
const bounded = (values: unknown, limit: number): values is string[] => Array.isArray(values) && values.length <= 500 && values.every(v => typeof v === 'string' && v.length <= limit);

/** Local controls change only attention presentation. Continuous conditions keep
 * one episode identity even as their sliding evidence window changes. */
export class AttentionState {
  clearHistory():void{this.active.clear();this.acknowledged.clear();this.muted.clear();this.notified.clear();this.deliveries=[];this.notificationClock=-Infinity;this.preferenceInvalid=false;}
  private active = new Map<string, AttentionItem>();
  private acknowledged = new Set<string>();
  private muted = new Set<string>();
  private notified = new Set<string>();
  private deliveries: number[] = [];
  private notificationClock = -Infinity;
  preferenceInvalid = false;
  constructor(input?: unknown) {
    if (input === undefined) return;
    const value = input as AttentionPreferences;
    if (!value || value.version !== 1 || !bounded(value.acknowledged, 16384) || !bounded(value.muted, 8192)) { this.preferenceInvalid = true; return; }
    this.acknowledged = new Set(value.acknowledged); this.muted = new Set(value.muted);
  }
  update(candidates: readonly AttentionCandidate[]): void {
    const next = new Map<string, AttentionItem>();
    for (const candidate of candidates.slice(0, 200)) {
      const previous = this.active.get(candidate.conditionKey), id = previous?.id ?? candidate.id;
      next.set(candidate.conditionKey, { ...candidate, id, eventIds: [...candidate.eventIds], conversations: [...candidate.conversations], limitations: [...candidate.limitations],
        acknowledged: this.acknowledged.has(id), muted: this.muted.has(candidate.conditionKey) });
    }
    this.active = next;
    // Retired episodes need no delivery identity once their condition is gone.
    const ids = new Set([...next.values()].map(v => v.id)); this.notified = new Set([...this.notified].filter(id => ids.has(id)));
  }
  snapshot(): AttentionItem[] { return [...this.active.values()].map(v => ({ ...v, eventIds: [...v.eventIds], conversations: [...v.conversations], limitations: [...v.limitations] })); }
  get(id: string): AttentionItem | undefined { return this.snapshot().find(v => v.id === id); }
  acknowledge(id: string): boolean { const item = this.get(id); if (!item) return false; this.acknowledged.add(item.id); this.trim(); this.refreshFlags(); return true; }
  toggleMute(id: string): boolean { const item = this.get(id); if (!item) return false; if (this.muted.has(item.conditionKey)) this.muted.delete(item.conditionKey); else this.muted.add(item.conditionKey); this.trim(); this.refreshFlags(); return true; }
  private trim(): void { for (const set of [this.acknowledged, this.muted]) while (set.size > 500) set.delete(set.values().next().value!); }
  private refreshFlags(): void { for (const item of this.active.values()) { item.acknowledged = this.acknowledged.has(item.id); item.muted = this.muted.has(item.conditionKey); } }
  preferences(): AttentionPreferences { return { version: 1, acknowledged: [...this.acknowledged], muted: [...this.muted] }; }
  notifications(enabled: boolean, now: number): AttentionItem[] {
    if (!Number.isFinite(now)) return [];
    now = Math.max(now, this.notificationClock); this.notificationClock = now;
    this.deliveries = this.deliveries.filter(t => now - t < 60000);
    if (!enabled) return [];
    const result: AttentionItem[] = [];
    for (const item of this.snapshot().sort((a, b) => a.severity.localeCompare(b.severity))) {
      if (this.deliveries.length >= 3) break;
      if (!item.notifyEligible || item.severity === 'information' || item.muted || item.acknowledged || this.notified.has(item.id)) continue;
      this.notified.add(item.id); this.deliveries.push(now); result.push(item);
    }
    return result;
  }
}
