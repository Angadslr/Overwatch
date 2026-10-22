import { createInterface } from 'node:readline';
import { readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';

// A disposable stdio-only MCP server: one fixed invented file, no network or writes.
const root = await realpath(process.argv[2]);
if ((await readFile(join(root, '.overwatch-probe-fixture'), 'utf8')).trim() !== 'overwatch-invented-fixture-v1') {
  throw new Error('invented-fixture-required');
}
for await (const line of createInterface({ input: process.stdin })) {
  let request;
  try { request = JSON.parse(line); } catch { continue; }
  if (request.id === undefined) continue;
  let result;
  let error;
  switch (request.method) {
    case 'initialize':
      result = { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'overwatch-invented-fixture', version: '1.0.0' } };
      break;
    case 'ping': result = {}; break;
    case 'tools/list':
      result = { tools: [{ name: 'read_invented_fixture', description: 'Read only the invented read.txt fixture in this local test workspace.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } }] };
      break;
    case 'tools/call':
      if (request.params?.name === 'read_invented_fixture') {
        result = { content: [{ type: 'text', text: await readFile(join(root, 'read.txt'), 'utf8') }] };
      } else error = { code: -32602, message: 'Unknown fixture tool' };
      break;
    default: error = { code: -32601, message: 'Method not found' };
  }
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, ...(error ? { error } : { result }) }) + '\n');
}
