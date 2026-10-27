import type { EventV1 } from './contracts';
import type { DeliveryOrigin } from './lifecycle';
export interface HealthSnapshot {
  transport: 'disabled' | 'ready' | 'degraded' | 'disconnected' | 'unsupported';
  publisherConfigured: boolean;
  nativeDelivery: 'awaiting-first-event' | 'source-event-observed';
  sourceCoverage: 'partial';
  sourceGapEvents: number;
  historyEvents: number;
  lastNativeReceipt?: string;
  status: string;
  privacy: { excluded: number; policyUnavailable: number; unresolved: number };
  producerLoss?:true;
}
/** Local readiness is independent of source coverage and native delivery.
 * Quiet sources are not declared disconnected or complete by a timer. */
export class CollectorHealth {
  private transport: HealthSnapshot['transport'] = 'disabled';
  private publisherConfigured = false;
  private nativeObserved = false;
  private lastNativeReceipt: string | undefined;
  private historyEvents = 0;
  private sourceGapEvents = 0;
  private producerLoss=false;
  reportProducerLoss():void{this.producerLoss=true;if(this.transport==='ready')this.transport='degraded';}
  private privacy = { excluded: 0, policyUnavailable: 0, unresolved: 0 };
  observePrivacy(reason: string | undefined): void {
    if (reason === 'excluded-path') this.privacy.excluded++;
    if (reason === 'policy-unavailable') this.privacy.policyUnavailable++;
    if (reason === 'path-unresolved') this.privacy.unresolved++;
  }
  beginCollection(): void {
    this.transport = 'ready';
    this.publisherConfigured = true;
    this.nativeObserved = false;
    this.lastNativeReceipt = undefined;
    this.historyEvents = 0;
    this.sourceGapEvents = 0;
    this.producerLoss=false;
    this.privacy = { excluded: 0, policyUnavailable: 0, unresolved: 0 };
  }
  disable(): void { this.transport = 'disabled'; this.publisherConfigured = false; }
  unavailable(): void { this.transport = 'unsupported'; this.publisherConfigured = false; }
  disconnect(): void { this.transport = 'disconnected'; }
  syncTransport(counters: {
    failures: number;
    rejected: number;
  }): void {
    if (this.transport === 'ready' && (counters.failures > 0 || counters.rejected > 0))
      this.transport = 'degraded';
  }
  observe(event: EventV1, origin: DeliveryOrigin): void {
    if (this.transport === 'disabled' || this.transport === 'unsupported')
      return;
    if (event.sourceEvent === 'transportGap')
      this.sourceGapEvents++;
    if (origin === 'replay') {
      this.historyEvents++;
      return;
    }
    if (event.source !== 'cursor-hook' || event.evidence.activity !== 'source-reported')
      return;
    this.nativeObserved = true;
    if (!this.lastNativeReceipt || event.receivedAt > this.lastNativeReceipt)
      this.lastNativeReceipt = event.receivedAt;
  }
  snapshot(): HealthSnapshot {
    let status: string;
    if (this.transport === 'disabled')
      status = 'Collection off';
    else if (this.transport === 'unsupported')
      status = 'Collection unavailable';
    else if (this.transport === 'disconnected')
      status = 'Collector disconnected · live state unknown';
    else {
      const readiness = this.transport === 'degraded' ? 'Telemetry degraded' : this.historyEvents > 0 && !this.nativeObserved ? 'History loaded · collector ready' : 'Collector ready';
      status = this.nativeObserved ? `${readiness} · native source activity observed · coverage partial`
        : `${readiness} · awaiting first native event · coverage partial`;
      if (this.sourceGapEvents > 0)
        status += ' · source gaps observed';
      if (this.producerLoss) status += ' · producer reported telemetry loss';
      if (this.privacy.policyUnavailable) status += ' · privacy policy unavailable: reduced collection';
      else if (this.privacy.excluded || this.privacy.unresolved) status += ' · privacy exclusions applied';
    }
    return { transport: this.transport, publisherConfigured: this.publisherConfigured,
      nativeDelivery: this.nativeObserved ? 'source-event-observed' : 'awaiting-first-event', sourceCoverage: 'partial',
      sourceGapEvents: this.sourceGapEvents, historyEvents: this.historyEvents, privacy: { ...this.privacy },
      ...(this.producerLoss?{producerLoss:true as const}:{}),
      ...(this.lastNativeReceipt === undefined ? {} : { lastNativeReceipt: this.lastNativeReceipt }), status };
  }
}
