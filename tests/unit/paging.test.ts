import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chronologicalPages, visibleDetailRows, VIEW_PAGE_ROWS} from '../../src/ui/paging';
import type {ActivityNode} from '../../src/ui/files';

test('chronological pages cover every retained event exactly once with bounded native child batches', () => {
  const entries = Array.from({length: 5000}, (_, index) => ({key: index}));
  const pages = chronologicalPages(entries);
  assert.ok(pages.every(page => page.length <= VIEW_PAGE_ROWS));assert.deepEqual(pages.flat(), entries);
  assert.deepEqual(chronologicalPages(entries.slice(0, 101)).map(page => page.length), [100, 1]);
  assert.deepEqual(chronologicalPages([]), []);
});

test('large per-file/session detail lists disclose omissions without mutating retained rows', () => {
  const rows: ActivityNode[] = Array.from({length: 250}, (_, index) => ({kind: 'file', id: String(index).padStart(3, '0'), label: 'read.txt', description: ''}));
  const visible = visibleDetailRows(rows);
  assert.equal(visible.length, VIEW_PAGE_ROWS + 1);assert.equal(rows.length, 250);
  assert.equal(visible.at(-1)?.kind, 'message');assert.ok(visible.at(-1)?.label.includes('150'));
  assert.deepEqual(visible.slice(0, -1), rows.slice(-VIEW_PAGE_ROWS));assert.equal(visibleDetailRows(rows.slice(0, 100)).length, 100);
});
