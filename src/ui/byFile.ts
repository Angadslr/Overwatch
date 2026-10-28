import * as vscode from 'vscode';
import { FilesTree, age, type ActivityNode } from './files';
import { projectFiles } from './fileProjection';
import {visibleDetailRows} from './paging';

export class ByFileTree implements vscode.TreeDataProvider<ActivityNode>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<ActivityNode | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  private readonly subscription: vscode.Disposable;
  private liveCache:{roots:ActivityNode[];rows:ReturnType<typeof projectFiles>}|undefined;
  private displayCache:{roots:ActivityNode[];rows:ReturnType<typeof projectFiles>;nodes?:ActivityNode[]}|undefined;
  constructor(private readonly conversations: FilesTree) {
    this.subscription = conversations.onDidChangeTreeData(() => {
      this.displayCache = undefined;this.liveCache = undefined;this.changed.fire(undefined);
    });
  }
  rows(): ReturnType<typeof projectFiles> {
    const roots = this.conversations.getChildren();
    if (this.displayCache?.roots === roots) return this.displayCache.rows;
    const rows = projectFiles(roots);this.displayCache = {roots, rows};return rows;
  }
  liveRows(): ReturnType<typeof projectFiles> {const roots=this.conversations.liveRoots();if(this.liveCache?.roots===roots)return this.liveCache.rows;const rows=projectFiles(roots);this.liveCache={roots,rows};return rows;}
  getChildren(node?: ActivityNode): ActivityNode[] {
    if (node) return node.kind === 'file-group' ? visibleDetailRows(node.children ?? []) : node.children ?? [];
    const rows = this.rows();
    if (this.displayCache?.nodes) return this.displayCache.nodes;
    const roots = new Map<string, ActivityNode>();
    for (const row of rows) {
      let root = roots.get(row.scope);
      if (!root) { root = { kind: 'root', id: row.scope, label: row.scopeLabel, description: '', children: [] }; roots.set(row.scope, root); }
      const operations = row.children.filter(n => n.operation).length;
      const local = row.children.length - operations;
      root.children!.push({ kind: 'file-group', id: row.key, label: row.relativePath,
        description: `${operations} source operations · ${row.sessions.length} source sessions · ${local} local observations · ${age(row.lastReceivedAt, this.conversations.display?.at ?? Date.now())}`,
        tooltip: [row.scopeLabel, `Identity evidence: ${row.identity}`, 'Source hints and physical samples are separate groups.', 'Source sessions are participation evidence; file actor remains unverified.', 'Disk persistence and acceptance: unknown'].join('\n'), children: row.children });
    }
    for (const root of roots.values()) root.description = `${root.children!.length} file evidence groups`;
    const nodes: ActivityNode[] = roots.size ? [...roots.values()] : [{ kind: 'message', id: 'files-empty', label: 'No resolved file activity', description: 'Unresolved file hints and shell/MCP internals remain unqualified' }];
    this.displayCache!.nodes = nodes;return nodes;
  }
  getTreeItem(node: ActivityNode): vscode.TreeItem { return this.conversations.getTreeItem(node); }
  dispose(): void { this.displayCache = undefined;this.liveCache = undefined;this.subscription.dispose(); this.changed.dispose(); }
}
