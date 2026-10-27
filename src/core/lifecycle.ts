import type { EventV1 } from './contracts';
import { snapshotEvent } from './eventValidation';
import { conversationKey, identityNamespace } from './identity';
import {ScopedEventSet} from './scopedEvents';
export type DeliveryOrigin = 'live' | 'replay';
export type TurnState = 'discovered' | 'activity-observed' | 'complete' | 'failed' | 'aborted' | 'ambiguous' | 'unknown';
export interface TurnActivity {
  key: string;
  conversationKey: string;
  generationId: string;
  state: TurnState;
  activityObserved: boolean;
  missingStart: boolean;
  liveStateUnknown: boolean;
  terminalReports: Array<'complete' | 'failed' | 'aborted'>;
  lastReceivedAt: string;
}
export interface ConversationActivity {
  key: string;
  state: 'discovered' | 'open' | 'closed' | 'unknown';
  available: true;
  unscopedActivity: boolean;
  lastReceivedAt: string;
}
export interface LifecycleSnapshot {
  conversations: ConversationActivity[];
  turns: TurnActivity[];
  coverageDropped: number;
}
interface ConversationFacts {
  key: string;
  startObserved: boolean;
  closed: boolean;
  liveStateUnknown: boolean;
  unscopedActivity: boolean;
  lastReceivedAt: string;
}
interface TurnFacts extends Omit<TurnActivity, 'state' | 'missingStart'> {
}
const LIMIT = 10000;
const SEEN_LIMIT = 100000;
export const generationKey = (event: EventV1): string => JSON.stringify([...identityNamespace(event), 'generation', event.conversationId, event.generationId]);
/** Independent source lifecycles. Operation outcomes never terminate a turn,
 * and a generation terminal never closes its conversation. */
export class LifecycleStore {
  private readonly conversations = new Map<string, ConversationFacts>();
  private readonly turns = new Map<string, TurnFacts>();
  private readonly seen = new ScopedEventSet();
  coverageDropped = 0;
  apply(input: EventV1, origin: DeliveryOrigin = 'live'): boolean {
    const checked = snapshotEvent(input, input.ingestSequence === undefined ? 'spool' : 'journal');
    if (!checked.ok)
      throw new Error('invalid-lifecycle-event');
    const event = checked.event;
    if (event.source !== 'cursor-hook' || !event.conversationId || event.lifecycleScope === 'child')
      return false;
    if (this.seen.has(event))
      return false;
    if (this.seen.size >= SEEN_LIMIT) {
      this.coverageDropped++;
      return false;
    }
    this.seen.add(event);
    const key = conversationKey(event, event.conversationId);
    let conversation = this.conversations.get(key);
    if (!conversation) {
      if (this.conversations.size >= LIMIT) {
        this.coverageDropped++;
        return false;
      }
      conversation = { key, startObserved: false, closed: false, liveStateUnknown: origin === 'replay',
        unscopedActivity: false, lastReceivedAt: event.receivedAt };
      this.conversations.set(key, conversation);
    }
    if (event.receivedAt > conversation.lastReceivedAt)
      conversation.lastReceivedAt = event.receivedAt;
    const terminal = event.evidence.completion === 'source-reported' && ['completed', 'failed', 'cancelled'].includes(event.phase);
    if (event.lifecycleScope === 'conversation') {
      if (event.sourceEvent === 'sessionStart' && event.phase === 'started') {
        conversation.startObserved = true;
        if (origin === 'live')
          conversation.liveStateUnknown = false;
      }
      if (event.sourceEvent === 'sessionEnd' && terminal)
        conversation.closed = true;
      return true;
    }
    if (!event.generationId) {
      conversation.unscopedActivity = true;
      return true;
    }
    const turnKey = generationKey(event);
    let turn = this.turns.get(turnKey);
    if (!turn) {
      if (this.turns.size >= LIMIT) {
        this.coverageDropped++;
        return true;
      }
      turn = { key: turnKey, conversationKey: key, generationId: event.generationId, activityObserved: false,
        liveStateUnknown: origin === 'replay', terminalReports: [], lastReceivedAt: event.receivedAt };
      this.turns.set(turnKey, turn);
    }
    if (event.receivedAt > turn.lastReceivedAt)
      turn.lastReceivedAt = event.receivedAt;
    if (event.lifecycleScope === 'generation') {
      if (event.sourceEvent === 'stop' && terminal) {
        const state = event.phase === 'completed' ? 'complete' : event.phase === 'failed' ? 'failed' : 'aborted';
        if (!turn.terminalReports.includes(state))
          turn.terminalReports.push(state);
      }
    }
    else {
      turn.activityObserved = true;
      // Fresh activity proves receipt in this generation, never current execution.
      if (origin === 'live') {
        turn.liveStateUnknown = false;
        conversation.liveStateUnknown = false;
      }
    }
    return true;
  }
  markLiveStateUnknown(): void {
    for (const conversation of this.conversations.values())
      conversation.liveStateUnknown = true;
    for (const turn of this.turns.values())
      turn.liveStateUnknown = true;
  }
  snapshot(): LifecycleSnapshot {
    return {
      conversations: [...this.conversations.values()].map(c => ({ key: c.key,
        state: c.closed ? 'closed' : c.liveStateUnknown ? 'unknown' : c.startObserved ? 'open' : 'discovered',
        available: true, unscopedActivity: c.unscopedActivity, lastReceivedAt: c.lastReceivedAt })),
      turns: [...this.turns.values()].map(t => ({ ...t, terminalReports: [...t.terminalReports],
        state: t.terminalReports.length > 1 ? 'ambiguous' : t.terminalReports[0] ?? (t.liveStateUnknown ? 'unknown' : t.activityObserved ? 'activity-observed' : 'discovered'),
        missingStart: t.terminalReports.length > 0 && !t.activityObserved,
        liveStateUnknown: t.terminalReports.length === 0 && t.liveStateUnknown })),
      coverageDropped: this.coverageDropped,
    };
  }
}
