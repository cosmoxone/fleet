import os from 'node:os';
import {
  client,
  methods,
  PROTOCOL_VERSION,
  type ClientApp,
  type ClientConnection,
} from '@agentclientprotocol/sdk';
import { createWebSocketStream } from '@agentclientprotocol/sdk/experimental/ws-client';
import type { FleetNode } from '../../core/node';
import { acpWebSocketUrlFromHttpBase } from '../../core/url';
import { createStdioAcpStream } from './stdioTransport';

/**
 * FLEET-ORCH-001 M0: the conversational half of the ACP→MCP bridge.
 *
 * Speaks the STANDARD ACP face only (no goose `_meta`) so any contract-1
 * node works. Permission requests are answered deny-first (reject_* option,
 * falling back to `cancelled`) — the standalone policy engine's safe
 * default; attaching to fleetd's permission hub comes with face-② M1.
 */

export interface TurnResult {
  sessionId: string;
  stopReason: string;
  /** Aggregated agent_message_chunk text (dsh <think> stays inline). */
  text: string;
  updateCount: number;
  permissionRequests: number;
}

type SessionUpdate = {
  sessionId: string;
  update: {
    /** SDK 1.x discriminator. */
    sessionUpdate?: string;
    /** v2 schema discriminator. */
    updateKind?: string;
    content?: unknown;
  };
};

export interface BridgeSession {
  connection: ClientConnection;
  sessionId: string;
  runPrompt(prompt: string, timeoutMs?: number): Promise<TurnResult>;
  /** Best-effort cancel of the in-flight prompt (dsh: noop per catalog). */
  cancel(): void;
  close(): void;
}

function rejectFirstOption(
  params: { options?: Array<{ optionId: string; kind?: string }> }
): { outcome: { outcome: 'selected'; optionId: string } | { outcome: 'cancelled' } } {
  const reject = params.options?.find((o) => o.kind === 'reject_once' || o.kind === 'reject_always');
  if (reject) {
    return { outcome: { outcome: 'selected', optionId: reject.optionId } };
  }
  return { outcome: { outcome: 'cancelled' } };
}

function textFromBlock(block: unknown): string {
  return block && typeof block === 'object' && (block as { type?: string }).type === 'text'
    ? String((block as { text?: unknown }).text ?? '')
    : '';
}

function textFromContent(content: unknown): string {
  if (Array.isArray(content)) {
    return content.map(textFromBlock).join('');
  }
  // agent_message_chunk content is a single ContentBlock, not an array.
  return textFromBlock(content);
}

export function collectTurnText(updates: SessionUpdate[]): string {
  const kindOf = (u: SessionUpdate) => u.update?.sessionUpdate ?? u.update?.updateKind;
  return updates
    .filter((u) => kindOf(u) === 'agent_message_chunk')
    .map((u) => textFromContent((u.update as { content?: unknown }).content))
    .join('');
}

/**
 * Connects to a fleet node, initializes on the standard face, and opens a
 * fresh session (one session per dispatch — M0 semantics; session pooling
 * arrives with the session manager).
 */
export type PermissionPolicy = (
  params: {
    sessionId: string;
    options?: Array<{ optionId: string; kind?: string; name?: string }>;
    [key: string]: unknown;
  }
) => MaybePromise<{ outcome: { outcome: 'selected'; optionId: string } | { outcome: 'cancelled' } }>;

export async function openBridgeSession(
  node: FleetNode,
  options: {
    permissionPolicy?: PermissionPolicy;
    /** Stream callback: fired for every session/update as it arrives (M2-alt agent face). */
    onUpdate?: (params: unknown) => void;
    /** Test seam: custom connection factory (default: WebSocket to node.url). */
    connect?: (app: ClientApp) => ClientConnection;
  } = {}
): Promise<BridgeSession> {  const updates: SessionUpdate[] = [];
  let permissionRequests = 0;
  const permissionPolicy = options.permissionPolicy ?? rejectFirstOption;

  const app = client({ name: 'fleet-bridge', version: '0.1.0' })
    .onNotification(methods.client.session.update, (context) => {
      updates.push(context.params as unknown as SessionUpdate);
      options.onUpdate?.(context.params);
    })
    .onRequest(methods.client.session.requestPermission, (context) => {
      permissionRequests += 1;
      return permissionPolicy(context.params as Parameters<PermissionPolicy>[0]) as never;
    });

  // Transport by node shape: `command` nodes speak stdio (F-3), others WS.
  const connection = options.connect
    ? options.connect(app)
    : node.command
      ? app.connect(createStdioAcpStream(node))
      : app.connect(createWebSocketStream(acpWebSocketUrlFromHttpBase(node.url, node.secret), {
          protocols: [],
        }));

  await connection.agent.request(methods.agent.initialize, {
    protocolVersion: PROTOCOL_VERSION,
    clientCapabilities: { elicitation: { form: {} } },
    clientInfo: { name: 'fleet-bridge', version: '0.1.0' },
  });

  const newSession = await connection.agent.request(methods.agent.session.new, {
    cwd: node.workingDir ?? os.tmpdir(),
    mcpServers: [],
  });
  const sessionId = String(newSession.sessionId);

  return {
    connection,
    sessionId,
    async runPrompt(prompt: string, timeoutMs = 120_000): Promise<TurnResult> {
      updates.length = 0;
      const before = permissionRequests;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const response = await Promise.race([
          connection.agent.request(methods.agent.session.prompt, {
            sessionId,
            prompt: [{ type: 'text', text: prompt }],
          }),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error(`dispatch timed out after ${timeoutMs}ms`)),
              timeoutMs
            );
          }),
        ]);
        const stop = (response as { stopReason?: string }).stopReason ?? 'end_turn';
        return {
          sessionId,
          stopReason: stop,
          text: collectTurnText(updates),
          updateCount: updates.length,
          permissionRequests: permissionRequests - before,
        };
      } finally {
        if (timer) {
          clearTimeout(timer);
        }
      }
    },
    cancel() {
      try {
        void connection.agent.notify(methods.agent.session.cancel, { sessionId });
      } catch {
        // Notification channel closed — nothing to cancel.
      }
    },
    close() {
      connection.close();
    },
  };
}

/** One-shot dispatch: open, prompt, close. Returns the aggregated turn. */
export async function dispatchToNode(
  node: FleetNode,
  prompt: string,
  timeoutMs = 120_000
): Promise<TurnResult> {
  const session = await openBridgeSession(node);
  try {
    return await session.runPrompt(prompt, timeoutMs);
  } finally {
    session.close();
  }
}
