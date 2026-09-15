import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { stdioDriver } from './driver';
import { methods, PROTOCOL_VERSION } from '@agentclientprotocol/sdk';
import type { FleetNode } from '../../../core/node';
import { validateFleetNode } from '../../../core/node';
import { resolveDriver } from '../index';
import { DRIVER_CAPABILITY_ENTRIES } from '../capabilities';

/**
 * The echo fixture is fleet's own stdio agent face (M2-alt) — the driver is
 * validated by consuming our own product exactly the way a third-party acpx
 * host would (self-dogfood; also validates the acpx-export entry shape).
 */
const AGENT_MAIN = new URL('../../../agent/src/main.ts', import.meta.url).pathname;
const TSX = new URL('../../../node_modules/.bin/tsx', import.meta.url).pathname;

const echoNode: FleetNode = {
  id: 'n-stdio-1',
  name: 'stdio self test',
  url: '',
  secret: '',
  command: TSX,
  args: [AGENT_MAIN, 'agent', '--node', 'dsh-local-minimax-m3'],
};

const wrapperNode: FleetNode = {
  // ssh-template proof: an arbitrary wrapper command is just a command.
  id: 'n-stdio-2',
  name: 'wrapper command test',
  url: '',
  secret: '',
  command: 'bash',
  args: ['-c', `exec ${TSX} ${AGENT_MAIN} agent --node dsh-local-minimax-m3`],
};

describe('stdio driver (F-3 spike)', () => {
  it('registers in the driver registry with a capability declaration', () => {
    expect(resolveDriver('stdio')).toBe(stdioDriver);
    expect(DRIVER_CAPABILITY_ENTRIES.stdio!.capabilities.transports).toEqual(['stdio']);
    expect(stdioDriver.capabilities().initializeMeta).toBe('standard');
  });

  it('validates stdio node shapes (command XOR url)', () => {
    expect(validateFleetNode(echoNode)).toBeNull();
    expect(validateFleetNode({ ...echoNode, command: '' })).toBe('commandRequired');
    expect(validateFleetNode({ ...echoNode, url: 'http://x' })).toBe('commandAndUrlBothSet');
    expect(validateFleetNode({ ...echoNode, args: [1] as unknown as string[] })).toBe('argsNotStrings');
    expect(validateFleetNode({ ...echoNode, env: { A: 1 } as unknown as Record<string, string> })).toBe('envNotStrings');
  });

  it(
    'runs a real ACP session over spawned stdio (self-dogfood: fleet agent face)',
    { timeout: 90_000 },
    async () => {
      const session = stdioDriver.connect(echoNode);
      try {
        const init = (await session.request(methods.agent.initialize, {
          protocolVersion: PROTOCOL_VERSION,
          clientCapabilities: {},
          clientInfo: { name: 'fleet-test', version: '0' },
        })) as { agentInfo?: { name?: string } };
        expect(init.agentInfo?.name).toBe('fleet-dsh-local-minimax-m3');

        const created = (await session.request(methods.agent.session.new, {
          cwd: '/tmp',
          mcpServers: [],
        })) as { sessionId: string };
        const response = (await session.request(methods.agent.session.prompt, {
          sessionId: created.sessionId,
          prompt: [{ type: 'text', text: 'Reply with exactly: STDIO-DRIVER-OK' }],
        })) as { stopReason?: string };
        expect(response.stopReason).toBe('end_turn');
      } finally {
        session.close();
      }
    }
  );

  it(
    'spawns through wrapper commands (ssh-template viability, N1)',
    { timeout: 90_000 },
    async () => {
      const report = await stdioDriver.healthCheck(wrapperNode);
      expect(report.ok).toBe(true);
      expect(report.agent?.name).toBe('fleet-dsh-local-minimax-m3');
    }
  );

  it('healthCheck reports a clear failure for a bad command', { timeout: 20_000 }, async () => {
    const report = await stdioDriver.healthCheck({
      ...echoNode,
      command: 'definitely-not-a-command-xyz',
      args: [],
    });
    expect(report.ok).toBe(false);
    expect(report.detail).toBeTruthy();
  });
});
