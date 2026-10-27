import * as vscode from 'vscode';
import { FilesTree, age, type ActivityNode } from './files';
import { projectFiles } from './fileProjection';

export class ByFileTree implements vscode.TreeDataProvider<ActivityNode>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<ActivityNode | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  private readonly subscription: vscode.Disposable;
  private liveCache:{roots:ActivityNode[];rows:ReturnType<typeof projectFiles>}|undefined;
  constructor(private readonly conversations: FilesTree) {
    this.subscription = conversations.onDidChangeTreeData(() => this.changed.fire(undefined));
  }
  rows(): ReturnType<typeof projectFiles> { return projectFiles(this.conversations.getChildren()); }
  liveRows(): ReturnType<typeof projectFiles> {const roots=this.conversations.liveRoots();if(this.liveCache?.roots===roots)return this.liveCache.rows;const rows=projectFiles(roots);this.liveCache={roots,rows};return rows;}
  getChildren(node?: ActivityNode): ActivityNode[] {
    if (node) return node.children ?? [];
    const roots = new Map<string, ActivityNode>();
    for (const row of this.rows()) {
      let root = roots.get(row.scope);
      if (!root) { root = { kind: 'root', id: row.scope, label: row.scopeLabel, description: '', children: [] }; roots.set(row.scope, root); }
      const operations = row.children.filter(n => n.operation).length;
      const local = row.children.length - operations;
      root.children!.push({ kind: 'file-group', id: row.key, label: row.relativePath,
        description: `${operations} source operations · ${row.sessions.length} source sessions · ${local} local observations · ${age(row.lastReceivedAt, this.conversations.display?.at ?? Date.now())}`,
        tooltip: [row.scopeLabel, `Identity evidence: ${row.identity}`, 'Source hints and physical samples are separate groups.', 'Source sessions are participation evidence; file actor remains unverified.', 'Disk persistence and acceptance: unknown'].join('\n'), children: row.children });
    }
    for (const root of roots.values()) root.description = `${root.children!.length} file evidence groups`;
    return roots.size ? [...roots.values()] : [{ kind: 'message', id: 'files-empty', label: 'No resolved file activity', description: 'Unresolved file hints and shell/MCP internals remain unqualified' }];
  }
  getTreeItem(node: ActivityNode): vscode.TreeItem { return this.conversations.getTreeItem(node); }
  dispose(): void { this.subscription.dispose(); this.changed.dispose(); }
}
