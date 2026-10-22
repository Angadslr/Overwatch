import { createHash, randomUUID } from 'node:crypto';
import { lstatSync, realpathSync, opendirSync, writeFileSync, renameSync, unlinkSync, readFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
import { PROBE_HOOKS, PERMISSION_HOOKS, COLLECTION_MARKER, type ProbeHook } from './probe';

const MAX_INPUT = 32 * 1024 * 1024;
const MAX_SPOOL_FILES = 500;
const KNOWN_FIELDS = ['conversation_id', 'generation_id', 'session_id', 'tool_use_id', 'tool_call_id', 'parent_conversation_id', 'subagent_id', 'agent_id', 'parent_id', 'subagent_type', 'hook_event_name', 'cursor_version', 'workspace_roots', 'tool_name', 'tool_input', 'tool_output', 'file_path', 'duration', 'status', 'failure_type', 'is_interrupt', 'reason', 'command', 'cwd', 'server', 'server_name', 'result_json', 'exit_code'] as const;
const INPUT_FIELDS = ['file_path', 'path', 'target_file', 'command', 'description', 'subagent_type', 'prompt', 'tasks', 'old_string', 'new_string', 'contents'] as const;
const TOOLS = new Set(['Read', 'ReadFile', 'read_file', 'read_file_v2', 'Write', 'Edit', 'EditFile', 'write_file', 'edit_file', 'StrReplace', 'str_replace', 'Shell', 'Bash', 'run_terminal_cmd', 'MCP', 'Task', 'Delete', 'DeleteFile', 'delete_file', 'Glob', 'Grep', 'Search']);

export function observationResponse(event: string): object {
  return (PERMISSION_HOOKS as readonly string[]).includes(event) ? { permission: 'allow' } : {};
}

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function opaque(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256) return undefined;
  return createHash('sha256').update(value).digest('hex');
}

function targetPath(value: unknown, root: string): string | undefined {
  if (typeof value !== 'string' || value.length > 4096 || value.includes('\0')) return undefined;
  const absolute = isAbsolute(value) ? value : join(root, value);
  try {
    let physical: string;
    try { physical = realpathSync(absolute); }
    catch { physical = join(realpathSync(dirname(absolute)), basename(absolute)); }
    const rel = relative(root, physical);
    if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return undefined;
    // This discovery probe records only explicitly invented fixture targets.
    return /^(read|edit|shared|missing|created|renamed)\.txt$/.test(rel) ? rel : undefined;
  } catch { return undefined; }
}

export function projectProbe(input: unknown, event: ProbeHook, root: string) {
  const payload = object(input);
  if (!payload) throw new Error('input-not-object');
  const roots = payload.workspace_roots;
  if (!Array.isArray(roots) || !roots.some(value => {
    try { return typeof value === 'string' && realpathSync(value) === root; }
    catch { return false; }
  })) return undefined;
  const args = object(payload.tool_input);
  const rawPath = payload.file_path ?? args?.file_path ?? args?.path ?? args?.target_file;
  const target = targetPath(rawPath, root);
  const version = typeof payload.cursor_version === 'string' && /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(payload.cursor_version) ? payload.cursor_version : undefined;
  const status = ['completed', 'aborted', 'error'].includes(String(payload.status)) ? payload.status : undefined;
  const failure = ['timeout', 'error', 'permission_denied'].includes(String(payload.failure_type)) ? payload.failure_type : undefined;
  return {
    probeSchemaVersion: 1, eventId: randomUUID(), source: 'cursor-hook-probe',
    receivedAt: new Date().toISOString(), hookEvent: event,
    declaredEventMatches: payload.hook_event_name === event,
    sourceVersion: version, rootKey: opaque(root),
    conversationKey: opaque(payload.conversation_id), generationKey: opaque(payload.generation_id),
    callKey: opaque(payload.tool_use_id), sessionKey: opaque(payload.session_id),
    toolCallKey: opaque(payload.tool_call_id), parentConversationKey: opaque(payload.parent_conversation_id),
    subagentKey: opaque(payload.subagent_id), agentKey: opaque(payload.agent_id), parentKey: opaque(payload.parent_id),
    toolName: typeof payload.tool_name === 'string' && TOOLS.has(payload.tool_name) ? payload.tool_name : typeof payload.tool_name === 'string' && payload.tool_name.startsWith('MCP:') ? 'MCP' : 'unknown',
    target, status, failure,
    durationMs: typeof payload.duration === 'number' && Number.isFinite(payload.duration) && payload.duration >= 0 ? Math.min(payload.duration, 86400000) : undefined,
    fieldTypes: Object.fromEntries(KNOWN_FIELDS.filter(key => Object.hasOwn(payload, key)).map(key => [key, Array.isArray(payload[key]) ? 'array' : payload[key] === null ? 'null' : typeof payload[key]])),
    inputFieldTypes: args ? Object.fromEntries(INPUT_FIELDS.filter(key => Object.hasOwn(args, key)).map(key => [key, Array.isArray(args[key]) ? 'array' : args[key] === null ? 'null' : typeof args[key]])) : undefined,
    workingDirectoryMatchesRoot: (() => { try { return realpathSync(process.cwd()) === root; } catch { return false; } })(),
    evidence: 'native-delivery-requires-manual-action-trace',
  };
}

function publish(storage: string, event: ReturnType<typeof projectProbe>): void {
  if (!event) return;
  const marker = join(storage, 'collection.enabled');
  const markerInfo = lstatSync(marker);
  if (!markerInfo.isFile() || markerInfo.isSymbolicLink() || markerInfo.size > 64 || readFileSync(marker, 'utf8') !== COLLECTION_MARKER) return;
  const inbox = join(storage, 'inbox');
  const info = lstatSync(inbox);
  if (!info.isDirectory() || info.isSymbolicLink() || realpathSync(inbox) !== inbox) return;
  // Bound enumeration as well as retained data; this is an approximate concurrent cap.
  const directory = opendirSync(inbox);
  let count = 0;
  try { while (directory.readSync()) { if (++count >= MAX_SPOOL_FILES) return; } }
  finally { directory.closeSync(); }
  const temporary = join(inbox, `${event.eventId}.tmp`);
  try {
    writeFileSync(temporary, JSON.stringify(event) + '\n', { flag: 'wx', mode: 0o600 });
    renameSync(temporary, join(inbox, `${event.eventId}.json`));
  } catch {
    try { unlinkSync(temporary); } catch { /* Missing temp file requires no cleanup. */ }
  }
}

export function runHook(argv: string[]): void {
  const [storage, root, requestedEvent] = argv;
  const event = PROBE_HOOKS.find(value => value === requestedEvent);
  // One response, independent of malformed input and telemetry persistence failures.
  process.stdout.write(JSON.stringify(observationResponse(requestedEvent ?? '')) + '\n');
  if (!event || !storage || !root) return;
  let bytes = 0;
  let exceeded = false;
  const chunks: Buffer[] = [];
  const deadline = setTimeout(() => { process.stdin.destroy(); }, 1500);
  process.stdin.on('data', (chunk: Buffer) => {
    bytes += chunk.length;
    if (bytes > MAX_INPUT) { exceeded = true; chunks.length = 0; return; }
    if (!exceeded) chunks.push(chunk);
  });
  process.stdin.on('error', () => { clearTimeout(deadline); });
  process.stdin.on('close', () => { clearTimeout(deadline); });
  process.stdin.on('end', () => {
    clearTimeout(deadline);
    if (exceeded) return;
    try { publish(storage, projectProbe(JSON.parse(Buffer.concat(chunks).toString('utf8')), event, realpathSync(root))); }
    catch { /* Deliberately omit raw input and exception messages from logs. */ }
  });
}

