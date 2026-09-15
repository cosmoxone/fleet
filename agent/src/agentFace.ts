import { randomUUID } from 'node:crypto';
import {
  agent,
  methods,
  PROTOCOL_VERSION,
  type AgentApp,
  type ClientApp,
  type ClientConnection,
} from '@agentclientprotocol/sdk';
import { loadFleetNodes } from '../../bridge/src/nodes';
import { openBridgeSession, type BridgeSession, type PermissionPolicy } from '../../bridge/src/dispatch';
import { parseNodeMention, type PromptBlock } from './routing';
import { fleetNodeSlug, type FleetNode } from '../../core/node';

/**
 * FLEET-HUB-001 M2-alt — face ⑥: `fleet agent` as a single-process stdio ACP
 * agent (HUB v0.7 scope).
 *
 * Modes:
 *  - passthrough (`--node <slug>`): this process IS that node (agentInfo
 *    `fleet-<slug>`); backend session opens eagerly at session/new (fail fast).
 *  - hub (no `--node`): the whole fleet via @slug mentions (Layer 3) with a
 *    default-node fallback; per-node backend sessions keep each node's history
 *    clean; the first reply chunk of each turn is tagged `[slug] `.
 *
 * Guardrails (HUB v0.7): mentions strip REGISTERED slugs only; prompts are
 * serialized per host session; permission requests relay to the host
 * (interactive context — unlike the M0 bridge's deny-first tool context).
 */

export interface FleetAgentOptions {
  settingsPath: string;
  /** Passthrough mode when set (node slug). */
  node?: string;
  /** Test seam: backend connection factory keyed by node. */
  connectForNode?: (node: FleetNode, app: ClientApp) => ClientConnection;
  /** Test seam: node list override instead of reading settings. */
  nodesOverride?: FleetNode[];
}

interface HostClient {
  request(method: string, params: unknown): Promise<unknown>;
  notify(method: string, params: unknown): Promise<void>;
}

interface HostSessionState {
  backends: Map<string, BridgeSession>;
  queue: Promise<unknown>;
  client?: HostClient;
  /** First agent_message_chunk of the current turn still needs its [slug] tag. */
  tagFirstChunk: boolean;
}

export function createFleetAgentApp(options: FleetAgentOptions): AgentApp {
  const nodes = options.nodesOverride ?? loadFleetNodes(options.settingsPath);
  const bySlug = new Map(nodes.map((n) => [fleetNodeSlug(n), n]));

  let boundNode: FleetNode | undefined;
  if (options.node) {
    boundNode = bySlug.get(options.node);
    if (!boundNode) {
      throw new Error(
        `unknown fleet node: ${options.node} (known: ${[...bySlug.keys()].join(', ')})`
      );
    }
  }
  const hubMode = !boundNode;
  const defaultSlug = [...bySlug.keys()][0];
  const agentName = boundNode ? `fleet-${fleetNodeSlug(boundNode)}` : 'fleet-hub';

  const hostSessions = new Map<string, HostSessionState>();

  function tagContent(content: unknown, prefix: string): unknown {
    if (content && typeof content === 'object' && (content as { type?: string }).type === 'text') {
      return { ...content, text: `${prefix}${String((content as { text?: string }).text ?? '')}` };
    }
    return content;
  }

  function openBackend(
    node: FleetNode,
    hostSessionId: string,
    host: HostSessionState
  ): Promise<BridgeSession> {
    const tag = hubMode ? fleetNodeSlug(node) : null;
    const permissionPolicy: PermissionPolicy = async (params) => {
      if (!host.client) {
        return { outcome: { outcome: 'cancelled' } };
      }
      return (await host.client.request(methods.client.session.requestPermission, params)) as {
        outcome: { outcome: 'selected'; optionId: string } | { outcome: 'cancelled' };
      };
    };
    const connectOption = options.connectForNode
      ? { connect: (app: ClientApp) => options.connectForNode!(node, app) }
      : {};
    return openBridgeSession(node, {
      ...connectOption,
      permissionPolicy,
      onUpdate: (raw) => {
        const params = raw as {
          update?: { sessionUpdate?: string; updateKind?: string; content?: unknown };
        };
        const update = params?.update;
        if (!update) {
          return;
        }
        let payload: unknown = raw;
        const kind = update.sessionUpdate ?? update.updateKind;
        if (
          tag &&
          host.tagFirstChunk &&
          kind === 'agent_message_chunk' &&
          update.content &&
          typeof update.content === 'object' &&
          (update.content as { type?: string }).type === 'text'
        ) {
          host.tagFirstChunk = false;
          payload = { ...params, update: { ...update, content: tagContent(update.content, `[${tag}] `) } };
        }
        void host.client?.notify(methods.client.session.update, payload);
      },
    });
  }

  const app = agent({ name: agentName });

  app.onRequest(methods.agent.initialize, () => ({
    protocolVersion: PROTOCOL_VERSION,
    agentInfo: { name: agentName, version: '0.1.0' },
    capabilities: { loadSession: false },
  }));

  app.onRequest(methods.agent.session.new, async () => {
    const id = randomUUID();
    const state: HostSessionState = {
      backends: new Map(),
      queue: Promise.resolve(),
      tagFirstChunk: true,
    };
    hostSessions.set(id, state);
    if (boundNode) {
      state.backends.set(fleetNodeSlug(boundNode), await openBackend(boundNode, id, state));
    }
    return { sessionId: id };
  });

  app.onRequest(methods.agent.session.prompt, (context) => {
    const hostSessionId = context.params.sessionId;
    const host = hostSessions.get(hostSessionId);
    if (!host) {
      throw new Error(`unknown session: ${hostSessionId}`);
    }
    const client = context.client as unknown as HostClient;

    const run = async (): Promise<{ stopReason: string }> => {
      host.client = client;
      host.tagFirstChunk = true;

      let targetSlug: string;
      let blocks = context.params.prompt as PromptBlock[];
      if (hubMode) {
        const decision = parseNodeMention(blocks, [...bySlug.keys()]);
        targetSlug = decision.slug ?? defaultSlug!;
        blocks = decision.blocks;
      } else {
        targetSlug = fleetNodeSlug(boundNode!);
      }
      const node = bySlug.get(targetSlug);
      if (!node) {
        throw new Error('no fleet node available (empty registry or no default)');
      }

      let backend = host.backends.get(targetSlug);
      if (!backend) {
        backend = await openBackend(node, hostSessionId, host);
        host.backends.set(targetSlug, backend);
      }

      try {
        const response = (await backend.connection.agent.request(
          methods.agent.session.prompt,
          { sessionId: backend.sessionId, prompt: blocks }
        )) as { stopReason?: string };
        return { stopReason: response.stopReason ?? 'end_turn' };
      } finally {
        host.client = undefined;
      }
    };

    // Serialize prompts per host session (guardrail).
    const next = host.queue.then(run, run);
    host.queue = next.catch(() => undefined);
    return next;
  });

  app.onNotification(methods.agent.session.cancel, (context) => {
    const host = hostSessions.get((context.params as { sessionId?: string }).sessionId ?? '');
    if (!host) {
      return;
    }
    for (const backend of host.backends.values()) {
      backend.cancel();
    }
  });

  return app;
}
