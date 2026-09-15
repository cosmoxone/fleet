import { Readable, Writable } from 'node:stream';
import { ndJsonStream } from '@agentclientprotocol/sdk';

/**
 * Stdio transport for the ACP agent app: newline-delimited JSON-RPC over
 * process stdin/stdout (the acpx/spawn convention). Node web-stream adapters
 * feed the SDK's ndJsonStream directly — no hand-rolled polling.
 */
export function createStdioAgentTransport() {
  return ndJsonStream(
    Writable.toWeb(process.stdout) as WritableStream<Uint8Array>,
    Readable.toWeb(process.stdin) as unknown as ReadableStream<Uint8Array>
  );
}
