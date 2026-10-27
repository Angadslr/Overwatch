import type { ConversationIdentities } from '../core/identity';
import type { LifecycleSnapshot, TurnActivity } from '../core/lifecycle';
export interface ConversationNode {
  key: string;
  label: string;
  description: string;
  tooltip: string;
  children: Array<{
    key: string;
    label: string;
    description: string;
    tooltip: string;
  }>;
}
/** Presentation contains no attribution heuristics and does not rewrite evidence. */
export function conversationNodes(identities: ConversationIdentities, lifecycle?: LifecycleSnapshot): ConversationNode[] {
  const snapshot = identities.snapshot();
  const conversations = new Map(lifecycle?.conversations.map(c => [c.key, c]));
  const turnsByConversation = new Map<string, TurnActivity[]>();
  for (const turn of lifecycle?.turns ?? []) {
    const lines = turnsByConversation.get(turn.conversationKey) ?? [];
    lines.push(turn);
    turnsByConversation.set(turn.conversationKey, lines);
  }
  return snapshot.sessions.map(session => {
    const conversation = conversations.get(session.key);
    const turns = turnsByConversation.get(session.key) ?? [];
    const turnLabels: Record<TurnActivity['state'], string> = { discovered: 'Turn discovered', 'activity-observed': 'Turn activity observed',
      complete: 'Turn complete · source report', failed: 'Turn failed · source report', aborted: 'Turn aborted · source report',
      ambiguous: 'Ambiguous turn evidence', unknown: 'Turn live state unknown after reload' };
    const description = conversation?.state === 'unknown' ? 'Live state unknown after reload'
      : conversation?.state === 'closed' ? 'Session end reported' : turns.length === 1 ? turnLabels[turns[0]!.state]
        : turns.length ? `${turns.length} turns observed` : 'Source session';
    return {
      key: session.key,
      label: `${session.alias} · ${session.sourceId.slice(0, 10)}`,
      description: `${description} · file actor unverified`,
      tooltip: [`Source session: ${session.sourceId}`, `Identity scope: ${session.key}`, `Conversation: ${conversation?.state ?? 'discovered'} · history retained`,
        ...turns.slice(-20).map(turn => `Turn ${turn.generationId}: ${turn.liveStateUnknown ? 'live state unknown after reload' : turn.state}${turn.missingStart ? ' · earlier activity not observed' : ''}`),
        ...(turns.length > 20 ? [`${turns.length - 20} additional turn records retained.`] : []),
        ...(conversation?.unscopedActivity ? ['Activity without a generation ID remains unscoped.'] : []), 'Alias is local presentation; file actor remains unverified.'].join('\n'),
      children: snapshot.children.filter(c => c.parents.includes(session.key)).map(child => ({
        key: child.key,
        label: `Child ${child.sourceId.slice(0, 10)}`,
        description: child.ambiguous ? 'Ambiguous lifecycle evidence' : child.terminalReports.length
          ? `Child ${child.terminalReports[0]} · source report` : child.startObserved ? 'Child start reported' : 'Child lifecycle unknown',
        tooltip: [`Lifecycle source ID: ${child.sourceId}`, `Parent source identity: ${session.sourceId}`,
          `Start observed: ${child.startObserved}`, 'Child-to-file ownership: unverified'].join('\n'),
      })),
    };
  });
}
