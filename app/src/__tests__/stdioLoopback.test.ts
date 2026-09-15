import { describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { startStdioLoopback } from '../utils/stdioLoopback';

/** Minimal ndjson ACP echo agent: replies to initialize with a fixed payload. */
const ECHO_AGENT = [
  "const rl = require('node:readline').createInterface({ input: process.stdin });",
  "rl.on('line', (line) => {",
  "  if (!line.trim()) return;",
  "  const m = JSON.parse(line);",
  "  if (m.id === undefined || m.id === null) return;",
  "  if (m.method === 'initialize') {",
  "    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: 1, agentInfo: { name: 'echo-agent', version: '0' } } }) + '\\n');",
  "  } else {",
  "    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { echo: m.params } }) + '\\n');",
  "  }",
  "});",
].join(' ');

describe('stdioLoopback (F-3 follow-up: loopback materialization)', () => {
  it('materializes a stdio agent as a token-guarded loopback WS endpoint', async () => {
    const loopback = await startStdioLoopback({
      command: process.execPath,
      args: ['-e', ECHO_AGENT],
    });
    try {
      // Wrong token: connection opens, then the server closes it with 4401.
      const badUrl = loopback.acpUrl.replace(/token=.*/, 'token=wrong');
      const closedWith = await new Promise<number>((resolve, reject) => {
        const ws = new WebSocket(badUrl);
        ws.on('error', (e) => reject(e));
        ws.on('close', (code) => resolve(code));
      });
      expect(closedWith).toBe(4401);

      // Right token: full ndjson round-trip through a spawned agent.
      const reply = await new Promise<string>((resolve, reject) => {
        const ws = new WebSocket(loopback.acpUrl);
        ws.on('error', reject);
        ws.on('open', () => {
          ws.send(JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'initialize', params: { x: 1 } }));
        });
        ws.on('message', (data) => {
          resolve(String(data));
          ws.close();
        });
      });
      const parsed = JSON.parse(reply) as { result: { agentInfo: { name: string } } };
      expect(parsed.result.agentInfo.name).toBe('echo-agent');

      // Framing across chunk boundaries: two requests, two framed lines back.
      const replies: string[] = [];
      await new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(loopback.acpUrl);
        ws.on('error', reject);
        ws.on('open', () => {
          ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }));
          ws.send(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'pong' }));
        });
        ws.on('message', (data) => {
          replies.push(String(data));
          if (replies.length === 2) {
            ws.close();
            resolve();
          }
        });
      });
      expect(replies).toHaveLength(2);
      expect(JSON.parse(replies[0]!).id).toBe(1);
      expect(JSON.parse(replies[1]!).id).toBe(2);
    } finally {
      await loopback.close();
    }
  });

  it('close() tears down sockets and children', async () => {
    const loopback = await startStdioLoopback({
      command: process.execPath,
      args: ['-e', ECHO_AGENT],
    });
    const ws = new WebSocket(loopback.acpUrl);
    await new Promise<void>((resolve) => ws.on('open', () => resolve()));
    await loopback.close();
    expect(ws.readyState).toBeGreaterThanOrEqual(WebSocket.CLOSING);
    ws.terminate();
  });
});
