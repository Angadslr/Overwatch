import type { EventV1 } from './contracts';
import { snapshotEvent } from './eventValidation';

export type IdentityScope = Pick<EventV1, 'collectorId' | 'environmentId' | 'workspaceId' | 'worktreeId'>;
export const identityNamespace = (scope: IdentityScope): Array<string | null> =>
  [scope.collectorId, scope.environmentId, scope.workspaceId, scope.worktreeId ?? null];
export const conversationKey = (scope: IdentityScope, sourceId: string): string =>
  JSON.stringify([...identityNamespace(scope), 'conversation', sourceId]);
const childKey = (scope: IdentityScope, sourceId: string): string =>
  JSON.stringify([...identityNamespace(scope), 'child', sourceId]);
const LIMIT = 10000;

export interface AliasState {
  version: 1;
  aliases: Array<{ key: string; number: number }>;
}
export interface ConversationIdentity {
  key: string;
  sourceId: string;
  alias: string;
}
export interface ChildIdentity {
  key: string;
  sourceId: string;
  parents: string[];
  startObserved: boolean;
  terminalReports: Array<'completed' | 'failed' | 'cancelled'>;
  ambiguous: boolean;
}

/** Aliases are presentation only. Explicit source IDs and full scope own identity.
 * Child lifecycle keys never become file-tool conversation IDs. */
export class ConversationIdentities {
  resetObserved(): void { this.sessions.clear(); this.children.clear(); }
  clearHistory():void{this.resetObserved();this.aliases.clear();this.nextAlias=1;this.coverageDropped=0;this.revision++;}
  private readonly aliases = new Map<string, number>();
  private readonly sessions = new Map<string, ConversationIdentity>();
  private readonly children = new Map<string, ChildIdentity>();
  private nextAlias = 1;
  revision = 0;
  coverageDropped = 0;

  constructor(state?: unknown) {
    if (state === undefined) return;
    const value = state as Partial<AliasState>;
    if (!value || value.version !== 1 || !Array.isArray(value.aliases) || value.aliases.length > LIMIT)
      throw new Error('invalid-alias-state');
    const numbers = new Set<number>();
    for (const entry of value.aliases) {
      if (!entry || typeof entry.key !== 'string' || !Number.isSafeInteger(entry.number) || entry.number < 1 ||
        entry.number > LIMIT || this.aliases.has(entry.key) || numbers.has(entry.number))
        throw new Error('invalid-alias-state');
      let key: unknown;
      try { key = JSON.parse(entry.key); } catch { throw new Error('invalid-alias-state'); }
      if (!Array.isArray(key) || key.length !== 6 || key[4] !== 'conversation' ||
        ![0, 1, 2, 5].every(i => typeof key[i] === 'string' && key[i].length > 0 && key[i].length <= 256) ||
        !(key[3] === null || typeof key[3] === 'string' && key[3].length <= 256) || JSON.stringify(key) !== entry.key)
        throw new Error('invalid-alias-state');
      this.aliases.set(entry.key, entry.number);
      numbers.add(entry.number);
      this.nextAlias = Math.max(this.nextAlias, entry.number + 1);
    }
  }

  private session(scope: IdentityScope, sourceId: string): ConversationIdentity | undefined {
    const key = conversationKey(scope, sourceId);
    const existing = this.sessions.get(key);
    if (existing) return existing;
    let number = this.aliases.get(key);
    if (number === undefined) {
      if (this.nextAlias > LIMIT) { this.coverageDropped++; return undefined; }
      number = this.nextAlias++;
      this.aliases.set(key, number);
      this.revision++;
    }
    const session = { key, sourceId, alias: `Session ${number}` };
    this.sessions.set(key, session);
    return session;
  }

  observe(input: EventV1): void {
    const checked = snapshotEvent(input, input.ingestSequence === undefined ? 'spool' : 'journal');
    if (!checked.ok) throw new Error('invalid-identity-event');
    const event = checked.event;
    if (event.conversationId) this.session(event, event.conversationId);
    if (event.source !== 'cursor-hook' || event.lifecycleScope !== 'child' || event.actorScope !== 'child' ||
      event.evidence.attribution !== 'child' || !event.actorId || !event.parentActorId ||
      !['subagentStart', 'subagentStop'].includes(event.sourceEvent)) return;
    const parent = this.session(event, event.parentActorId);
    if (!parent) return;
    const key = childKey(event, event.actorId);
    let child = this.children.get(key);
    if (!child) {
      if (this.children.size >= LIMIT) { this.coverageDropped++; return; }
      child = { key, sourceId: event.actorId, parents: [], startObserved: false, terminalReports: [], ambiguous: false };
      this.children.set(key, child);
    }
    if (!child.parents.includes(parent.key)) {
      // Two conflicting parents suffice to disclose ambiguity; retain no unbounded list.
      if (child.parents.length < 2) child.parents.push(parent.key);
      child.ambiguous = child.parents.length > 1;
    }
    if (event.sourceEvent === 'subagentStart' && event.phase === 'started') child.startObserved = true;
    if (event.sourceEvent === 'subagentStop' && ['completed', 'failed', 'cancelled'].includes(event.phase)) {
      const phase = event.phase as ChildIdentity['terminalReports'][number];
      if (!child.terminalReports.includes(phase)) child.terminalReports.push(phase);
      child.ambiguous ||= child.terminalReports.length > 1;
    }
  }

  snapshot(): { sessions: ConversationIdentity[]; children: ChildIdentity[]; coverageDropped: number } {
    return { sessions: [...this.sessions.values()].map(s => ({ ...s })),
      children: [...this.children.values()].map(c => ({ ...c, parents: [...c.parents], terminalReports: [...c.terminalReports] })),
      coverageDropped: this.coverageDropped };
  }
  aliasState(): AliasState {
    return { version: 1, aliases: [...this.aliases].map(([key, number]) => ({ key, number })) };
  }
}
