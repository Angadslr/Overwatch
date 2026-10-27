import type {EventV1} from './contracts';
import {identityNamespace} from './identity';
type ScopedEvent = Pick<EventV1,'collectorId'|'environmentId'|'workspaceId'|'worktreeId'|'eventId'>;
/** Retain a namespace once instead of repeating its serialized text in every
 * event key. Callers keep their existing total-identity capacity policy. */
export class ScopedEventSet {
 private readonly partitions = new Map<string, Set<string>>();
 private count = 0;
 get size():number { return this.count; }
 has(event:ScopedEvent):boolean { return this.partitions.get(JSON.stringify(identityNamespace(event)))?.has(event.eventId) ?? false; }
 add(event:ScopedEvent):void {
  const key=JSON.stringify(identityNamespace(event));
  let events=this.partitions.get(key);
  if(!events){events=new Set();this.partitions.set(key,events);}
  if(!events.has(event.eventId)){events.add(event.eventId);this.count++;}
 }
 clear():void { this.partitions.clear();this.count=0; }
}
