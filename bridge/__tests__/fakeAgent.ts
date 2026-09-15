import {
  agent,
  methods,
  PROTOCOL_VERSION,
  type AgentApp,
} from '@agentclientprotocol/sdk';

/** Shared in-process fake ACP node for bridge/agent tests (M0/M2-alt). */
export interface FakeAgentScript {
  chunks?: string[];
  askPermission?: boolean;
  /** Which option the fake expects the client to pick (default 'reject' — M0 deny-first). */
  expectedPermissionPick?: 'allow' | 'reject';
  neverRespond?: boolean;
}

/** Minimal contract-1 fake agent: initialize → newSession → prompt → end_turn. */
export function makeFakeAgent(script: FakeAgentScript): AgentApp {
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
      // The client must pick the option the script expects.
      const want = script.expectedPermissionPick ?? 'reject';
      if (answer.outcome.outcome !== 'selected' || answer.outcome.optionId !== want) {
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

