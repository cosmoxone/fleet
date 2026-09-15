#!/usr/bin/env node
/**
 * Minimal stdio ACP agent (fixture): answers initialize/session/new and, on
 * each prompt, issues ONE session/request_permission to the client, then
 * replies "ALLOWED:<optionId>" / "REJECTED" + end_turn. Drives the fleetd
 * permission-hub E2E.
 */
import { createInterface } from 'node:readline';

const rl = createInterface({ input: process.stdin });
const write = (obj) => process.stdout.write(JSON.stringify(obj) + '\n');

let nextId = 1;
/** permReqId → original prompt request id */
const openPerms = new Map();

rl.on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }

  // 1) Response to OUR permission request (has id, no method).
  if (msg.id !== undefined && msg.id !== null && !msg.method) {
    const promptId = openPerms.get(msg.id);
    if (promptId === undefined) return;
    openPerms.delete(msg.id);
    const outcome = msg.result?.outcome ?? { outcome: 'cancelled' };
    const text =
      outcome.outcome === 'selected' ? `ALLOWED:${outcome.optionId}` : 'REJECTED';
    write({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'ask-1', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } } } });
    write({ jsonrpc: '2.0', id: promptId, result: { stopReason: 'end_turn' } });
    return;
  }

  // 2) Client → agent requests.
  const { id, method, params } = msg;
  if (id === undefined || id === null) return;
  if (method === 'initialize') {
    write({ jsonrpc: '2.0', id, result: { protocolVersion: 1, agentInfo: { name: 'ask-agent', version: '0' }, capabilities: { loadSession: false } } });
  } else if (method === 'session/new') {
    write({ jsonrpc: '2.0', id, result: { sessionId: 'ask-1' } });
  } else if (method === 'session/prompt') {
    const permId = nextId++;
    openPerms.set(permId, id);
    write({
      jsonrpc: '2.0',
      id: permId,
      method: 'session/request_permission',
      params: {
        sessionId: params.sessionId,
        toolCall: { toolCallId: 'tc-1', title: 'echo tool', kind: 'execute' },
        options: [
          { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
          { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
        ],
      },
    });
  } else {
    write({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } });
  }
});

process.stdin.on('end', () => process.exit(0));
