import type {ActivityNode} from './files';
export const VIEW_PAGE_ROWS = 100;
/** Data remains retained; this bounds one native provider child request. */
export function visibleDetailRows(children: ActivityNode[]): ActivityNode[] {
  if (children.length <= VIEW_PAGE_ROWS) return children;
  const at = (node: ActivityNode): string => node.operation?.lastReceivedAt ?? node.observation?.event.receivedAt ?? node.localObservation?.event.receivedAt ?? '';
  const recent = [...children].sort((a, b) => at(a).localeCompare(at(b)) || a.id.localeCompare(b.id)).slice(-VIEW_PAGE_ROWS);
  return [...recent, {kind: 'message', id: 'more:' + recent[0]!.id, label: `${children.length - VIEW_PAGE_ROWS} additional rows retained`,
    description: 'Use Activity pages or filters to inspect the remaining evidence'}];
}
export function chronologicalPages<T>(entries: T[]): T[][] {
  const pages: T[][] = [];
  for (let offset = 0; offset < entries.length; offset += VIEW_PAGE_ROWS) pages.push(entries.slice(offset, offset + VIEW_PAGE_ROWS));
  return pages;
}
