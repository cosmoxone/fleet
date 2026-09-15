import { spawn } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import { ndJsonStream } from '@agentclientprotocol/sdk';
import type { Stream } from '@agentclientprotocol/sdk/dist/stream';
import type { FleetNode } from '../../core/node';

/**
 * Stdio transport for conversation-level sessions (F-3 nodes): spawn the
 * node's command and speak ndjson over its stdin/stdout. Used by
 * openBridgeSession when a node carries a `command` (WebSocket otherwise).
 */
export function createStdioAcpStream(node: FleetNode): Stream {
  if (!node.command) {
    throw new Error(`stdio transport requires a command (node: ${node.name})`);
  }
  const child = spawn(node.command, node.args ?? [], {
    env: { ...process.env, ...node.env },
    stdio: ['pipe', 'pipe', 'inherit'],
    cwd: node.workingDir || undefined,
  });
  child.on('error', (error) => {
    child.stdin?.destroy(error);
    child.stdout?.destroy(error);
  });
  return ndJsonStream(
    Writable.toWeb(child.stdin!) as WritableStream<Uint8Array>,
    Readable.toWeb(child.stdout!) as unknown as ReadableStream<Uint8Array>
  );
}
