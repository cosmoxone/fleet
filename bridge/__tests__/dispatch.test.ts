import { describe, expect, it } from 'vitest';
import {
  agent,
  methods,
  PROTOCOL_VERSION,
  type AgentApp,
} from '@agentclientprotocol/sdk';
import { collectTurnText, openBridgeSession, type BridgeSession } from '../src/dispatch';
import type { FleetNode } from '../../core/node';

interface FakeAgentScript {
  chunks?: string[];
  askPermission?: boolean;
  neverRespond?: boolean;
}

/** Minimal contract-1 fake agent: initialize → newSession → prompt → end_turn. */
function makeFakeAgent(script: FakeAgentScript): AgentApp {
  const app = agent({ name: 'fake-node' });
  app.onRequest(methods.agent.initialize, () => ({
    protocolVersion: PROTOCOL_VERSION,
    agentInfo: { name: 'fake-node', version: '0.0.0' },
    capabilities: { loadSession: false },
  }));
  app.onRequest(methods.agent.session.new, () => ({ sessionId: 'fake-session-1' }));
  app.onRequest(methods.agent.session.prompt, async (context) => {
    const { client } = context as unknown as {
      client: {
        notify(method: string, params: unknown): Promise<void>;
        request(method: string, params: unknown): Promise<{ outcome: { outcome: string; optionId?: string } }>;
      };
    };
    if (script.askPermission) {
      const answer = await client.request(methods.client.session.requestPermission, {
        sessionId: 'fake-session-1',
        toolCall: { toolCallId: 'tc-1', title: 'probe', kind: 'execute' },
        options: [
          { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
          { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
        ],
      });
      // The bridge must answer deny-first: reject_once option selected.
      if (answer.outcome.outcome !== 'selected' || answer.outcome.optionId !== 'reject') {
        throw new Error(
          `bridge permission policy violated: ${JSON.stringify(answer.outcome)}`
        );
      }
    }
    for (const chunk of script.chunks ?? ['hello ', 'from fake node']) {
      await client.notify(methods.client.session.update, {
        sessionId: 'fake-session-1',
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: chunk },
        },
      });
    }
    if (script.neverRespond) {
      await new Promise(() => undefined);
    }
    return { stopReason: 'end_turn' };
  });
  return app;
}

const node: FleetNode = {
  id: 'n1',
  name: 'fake node',
  url: 'http://127.0.0.1:9',
  secret: 's',
};

function openWith(script: FakeAgentScript): Promise<BridgeSession> {
  const fake = makeFakeAgent(script);
  // In-process pair: the SDK lets a client app connect straight to an agent
  // app — no WebSocket, no ports (M0 unit seam).
  return openBridgeSession(node, { connect: (app) => app.connect(fake) });
}

describe('openBridgeSession (in-process fake agent, standard ACP face)', () => {
  it('aggregates agent_message_chunk text until end_turn', async () => {
    const session = await openWith({ chunks: ['DESKTOP', '-', 'OK'] });
    try {
      const result = await session.runPrompt('Reply with exactly: DESKTOP-OK');
      expect(result.stopReason).toBe('end_turn');
      expect(result.text).toBe('DESKTOP-OK');
      expect(result.sessionId).toBe('fake-session-1');
      expect(result.updateCount).toBe(3);
      expect(result.permissionRequests).toBe(0);
    } finally {
      session.close();
    }
  });

  it('answers permission requests deny-first (reject_once option)', async () => {
    const session = await openWith({ chunks: ['done'], askPermission: true });
    try {
      const result = await session.runPrompt('run a tool');
      // The fake agent throws unless the bridge picked the reject option.
      expect(result.permissionRequests).toBe(1);
      expect(result.text).toBe('done');
    } finally {
      session.close();
    }
  });

  it('times out and reports when the node never responds', async () => {
    const session = await openWith({ neverRespond: true });
    try {
      await expect(session.runPrompt('stuck', 150)).rejects.toThrow(/timed out after 150ms/);
    } finally {
      session.close();
    }
  });

  it('uses the agent method surface the bridge expects', () => {
    // Guard against SDK method-name drift breaking the wiring silently.
    expect(methods.client.session.update).toBe('session/update');
    expect(methods.client.session.requestPermission).toBe('session/request_permission');
  });
});

describe('collectTurnText', () => {
  it('joins text chunks and skips other update kinds', () => {
    const text = collectTurnText([
      { sessionId: 's', update: { updateKind: 'agent_message_chunk', content: { type: 'text', text: 'a' } } },
      { sessionId: 's', update: { updateKind: 'plan', content: { type: 'text', text: 'IGNORED' } } },
      { sessionId: 's', update: { updateKind: 'agent_message_chunk', content: { type: 'text', text: 'b' } } },
    ]);
    expect(text).toBe('ab');
  });
});
