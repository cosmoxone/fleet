import { describe, expect, it } from 'vitest';
import {
  client,
  methods,
  PROTOCOL_VERSION,
  type ClientApp,
} from '@agentclientprotocol/sdk';
import { createFleetAgentApp } from '../src/agentFace';
import { makeFakeAgent } from '../../bridge/__tests__/fakeAgent';
import { fleetNodeSlug, type FleetNode } from '../../core/node';

/**
 * In-process pair ×2: host client ⇄ fleet agent ⇄ fake node backends.
 * The backend seam (connectForNode) routes each openBridgeSession to a
 * per-slug fake agent — no sockets anywhere (M2-alt guardrails under test).
 */

const GOOSE: FleetNode = {
  id: 'n1',
  name: 'goose office',
  url: 'http://127.0.0.1:1',
  secret: 's',
  slug: 'goose-office',
};
const DSH: FleetNode = {
  id: 'n2',
  name: 'dsh local',
  url: 'http://127.0.0.1:2',
  secret: 's',
  slug: 'dsh-local',
};

interface HostCapture {
  reply: string;
  stopReason: string;
  updates: string[];
  permissionPicks: string[];
}

async function runHostTurn(
  fleetAgent: ReturnType<typeof createFleetAgentApp>,
  prompt: string,
  options: { answerPermission?: 'allow' | 'reject' } = {}
): Promise<HostCapture> {
  const capture: HostCapture = { reply: '', stopReason: '', updates: [], permissionPicks: [] };
  const host: ClientApp = client({ name: 'host-test' })
    .onNotification(methods.client.session.update, (context) => {
      const params = context.params as {
        update: { sessionUpdate?: string; content?: { type?: string; text?: string } };
      };
      if (params.update?.sessionUpdate === 'agent_message_chunk') {
        capture.updates.push(params.update.content?.text ?? '');
      }
    })
    .onRequest(methods.client.session.requestPermission, (context) => {
      const opts = (context.params as { options: Array<{ optionId: string }> }).options ?? [];
      const want = options.answerPermission === 'reject' ? 'reject' : 'allow';
      const pick = opts.find((o) => o.optionId.startsWith(want)) ?? opts[0];
      capture.permissionPicks.push(pick?.optionId ?? 'none');
      return { outcome: { outcome: 'selected', optionId: pick?.optionId ?? '' } };
    });

  const connection = host.connect(fleetAgent);
  const init = await connection.agent.request(methods.agent.initialize, {
    protocolVersion: PROTOCOL_VERSION,
    clientCapabilities: {},
    clientInfo: { name: 'host-test', version: '0' },
  });
  expect(init.agentInfo?.name).toBeTruthy();
  const session = await connection.agent.request(methods.agent.session.new, {
    cwd: '/tmp',
    mcpServers: [],
  });
  const response = await connection.agent.request(methods.agent.session.prompt, {
    sessionId: session.sessionId,
    prompt: [{ type: 'text', text: prompt }],
  });
  capture.stopReason = (response as { stopReason?: string }).stopReason ?? '';
  capture.reply = capture.updates.join('');
  connection.close();
  return capture;
}

describe('fleet agent face (M2-alt)', () => {
  it('passthrough mode relays updates and stopReason from the bound node', async () => {
    const fake = makeFakeAgent({ chunks: ['PASSTHROUGH', '-OK'] });
    const app = createFleetAgentApp({
      settingsPath: '/dev/null',
      node: 'goose-office',
      nodesOverride: [GOOSE],
      connectForNode: (node, bridgeApp) => {
        expect(fleetNodeSlug(node)).toBe('goose-office');
        return bridgeApp.connect(fake);
      },
    });
    const result = await runHostTurn(app, 'Reply with exactly: PASSTHROUGH-OK');
    expect(result.stopReason).toBe('end_turn');
    // No [slug] tagging in passthrough mode (single node is self-evident).
    expect(result.reply).toBe('PASSTHROUGH-OK');
  });

  it('hub mode routes @slug to the right node, strips the mention, tags the first chunk', async () => {
    const gooseFake = makeFakeAgent({ chunks: ['from goose'] });
    const dshFake = makeFakeAgent({ chunks: ['from', ' dsh'] });
    const app = createFleetAgentApp({
      settingsPath: '/dev/null',
      nodesOverride: [GOOSE, DSH],
      connectForNode: (node, bridgeApp) =>
        bridgeApp.connect(fleetNodeSlug(node) === 'goose-office' ? gooseFake : dshFake),
    });
    const result = await runHostTurn(app, '@dsh-local who are you?');
    expect(result.stopReason).toBe('end_turn');
    // First chunk tagged with the slug; mention stripped before forwarding.
    expect(result.updates[0]).toBe('[dsh-local] from');
    expect(result.reply).toBe('[dsh-local] from dsh');
  });

  it('hub mode sends non-mention prompts to the default node untouched', async () => {
    const gooseFake = makeFakeAgent({ chunks: ['default ok'] });
    const app = createFleetAgentApp({
      settingsPath: '/dev/null',
      nodesOverride: [GOOSE, DSH],
      connectForNode: (node, bridgeApp) =>
        bridgeApp.connect(fleetNodeSlug(node) === 'goose-office' ? gooseFake : makeFakeAgent({})),
    });
    const result = await runHostTurn(app, 'plain prompt, @unknown-slug is not a node');
    expect(result.reply).toBe('[goose-office] default ok');
  });

  it('relays backend permission requests to the host (interactive context)', async () => {
    const fake = makeFakeAgent({ chunks: ['done'], askPermission: true, expectedPermissionPick: 'allow' });
    const app = createFleetAgentApp({
      settingsPath: '/dev/null',
      node: 'goose-office',
      nodesOverride: [GOOSE],
      connectForNode: (_node, bridgeApp) => bridgeApp.connect(fake),
    });
    const result = await runHostTurn(app, 'run a tool', { answerPermission: 'allow' });
    expect(result.permissionPicks).toEqual(['allow']);
    expect(result.reply).toBe('done');
  });

  it('rejects unknown passthrough node at construction (fail fast)', () => {
    expect(() =>
      createFleetAgentApp({ settingsPath: '/dev/null', node: 'nope', nodesOverride: [GOOSE] })
    ).toThrow(/unknown fleet node/);
  });
});
