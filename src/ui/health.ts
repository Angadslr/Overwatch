import * as vscode from 'vscode';
import { readinessIssues, type ReadinessInput } from '../core/readiness';
export interface HealthNode { id: string; label: string; description: string; tooltip: string; issue: boolean }
export function healthNodes(input: ReadinessInput): HealthNode[] {
  const node = (id: string, label: string, description: string, tooltip: string): HealthNode => ({ id, label, description, tooltip, issue: false });
  return [node('integration', 'Integration registration', input.registered ? 'Owned project hooks installed' : 'Not registered', 'This is local integration readiness, not proof that Cursor delivered an ordinary Agent event.'),
    node('helper', 'Helper self-check response', ['passed', 'delivery-timeout'].includes(input.check.state) ? 'response-verified' : input.check.state, 'Run Self-check to exercise the extension-owned helper. This makes no model call and does not verify native Agent delivery.'),
    node('ingestion', 'Collector self-check ingestion', input.check.state === 'passed' ? 'record-observed' : input.check.state === 'delivery-timeout' ? 'delivery-timeout' : 'not-proven-by-self-check', 'A successful helper response is separate from observing its unique diagnostic record in the collector.'),
    node('owner', 'Collector ownership', input.owner ? 'Owned consumer active' : input.ownership ?? 'Not owned', input.health.status),
    node('native', 'Native source evidence', input.health.nativeDelivery, 'Source coverage is partial. A self-check or replayed history cannot verify fresh native source delivery.'),
    node('coverage', 'Source coverage', 'Partial', 'Child-to-file attribution, shell/MCP file internals, saved bytes and acceptance remain unqualified in the current profile.'),
    node('queue', 'Ready queue sample', input.queue ? `${input.queue.readyFiles}${input.queue.incomplete ? '+' : ''} ready · oldest observed ${Math.floor(input.queue.oldestObservedAgeMs / 1000)}s` : 'Not sampled',
      input.queue ? `Metadata sample at ${input.queue.sampledAt}; at most 256 entries, not a complete disk audit. No payload content is read for this sample.` : 'Enable collection for bounded metadata sampling.'),
    ...readinessIssues(input).map(issue => ({ id: issue.code, label: issue.message, description: issue.code, tooltip: issue.action, issue: true }))];
}
export class HealthTree implements vscode.TreeDataProvider<HealthNode>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<HealthNode | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  constructor(private readonly snapshot: () => ReadinessInput) {}
  refresh(): void { this.changed.fire(undefined); }
  getChildren(): HealthNode[] { return healthNodes(this.snapshot()); }
  getTreeItem(node: HealthNode): vscode.TreeItem {
    const item = new vscode.TreeItem(node.label); item.id = node.id; item.description = node.description; item.tooltip = node.tooltip;
    item.iconPath = new vscode.ThemeIcon(node.issue ? 'warning' : 'pulse', new vscode.ThemeColor(node.issue ? 'list.warningForeground' : 'descriptionForeground'));
    item.accessibilityInformation = { label: `${node.label}, ${node.description}, ${node.tooltip}` };
    return item;
  }
  dispose(): void { this.changed.dispose(); }
}
