import { spawn, type ChildProcess } from 'node:child_process';
import {
  client,
  methods,
  PROTOCOL_VERSION,
  type ClientApp,
  type ClientConnection,
} from '@agentclientprotocol/sdk';
import { ndJsonStream } from '@agentclientprotocol/sdk';
import { Readable, Writable } from 'node:stream';
import type { AcpDriver, AcpSession, DriverCapabilities, HealthReport } from '../../../core/driver';
import { driverCapabilityEntry } from '../capabilities';
import type { FleetNode } from '../../../core/node';

/**
 * F-3: local stdio ACP driver. A node with `command` set spawns an ACP agent
 * process and speaks ndjson JSON-RPC over its stdin/stdout — the acpx/spawn
 * convention. Remote nodes need no extra transport: an `ssh` command template
 * (`ssh host -- hermes acp`) is just another command (N1 evaluation outcome).
 */

const HEALTH_CHECK_TIMEOUT_MS = 30_000; // spawned agents cold-boot (lazy deps, e.g. hermes)

export const stdioDriver: AcpDriver = {
  id: 'stdio',
  displayName: 'Local stdio ACP agent (spawn)',
  capabilities(): DriverCapabilities {
    // Single source: runtime/drivers/capabilities.json (FLEET-CATALOG-001).
    return driverCapabilityEntry('stdio').capabilities;
  },
  connect(node: FleetNode): AcpSession {
    const child = spawnChild(node);
    const app: ClientApp = client({ name: 'fleet' })
      .onRequest(methods.client.session.requestPermission, () => ({
        outcome: { outcome: 'cancelled' },
      }))
      .onNotification(methods.client.session.update, () => undefined);
    const stream = ndJsonStream(
      Writable.toWeb(child.stdin!) as WritableStream<Uint8Array>,
      Readable.toWeb(child.stdout!) as unknown as ReadableStream<Uint8Array>
    );
    const connection: ClientConnection = app.connect(stream);

    return {
      driverId: 'stdio',
      nodeId: node.id,
      request(method: string, params?: unknown): Promise<unknown> {
        return connection.agent.request(method, params);
      },
      close(): void {
        try {
          connection.close();
        } finally {
          child.kill();
        }
      },
    };
  },
  async healthCheck(node: FleetNode): Promise<HealthReport> {
    if (!node.command) {
      return {
        ok: false,
        detail: 'stdio node requires a command',
        checkedAt: new Date().toISOString(),
      };
    }
    let session: AcpSession | undefined;
    try {
      session = stdioDriver.connect(node);
      const init = (await Promise.race([
        session.request(methods.agent.initialize, {
          protocolVersion: PROTOCOL_VERSION,
          clientCapabilities: { elicitation: { form: {} } },
          clientInfo: { name: 'fleet-health', version: '0.0.0' },
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`initialize timed out after ${HEALTH_CHECK_TIMEOUT_MS}ms`)), HEALTH_CHECK_TIMEOUT_MS)
        ),
      ])) as { agentInfo?: { name?: string; version?: string } };
      return {
        ok: true,
        agent: init.agentInfo,
        checkedAt: new Date().toISOString(),
      };
    } catch (error) {
      return {
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
        checkedAt: new Date().toISOString(),
      };
    } finally {
      session?.close();
    }
  },
};

function spawnChild(node: FleetNode): ChildProcess {
  if (!node.command) {
    throw new Error(`stdio node "${node.name}" has no command`);
  }
  const child = spawn(node.command, node.args ?? [], {
    env: { ...process.env, ...node.env },
    stdio: ['pipe', 'pipe', 'inherit'],
    cwd: node.workingDir || undefined,
  });
  // spawn failures (ENOENT etc.) surface as an 'error' event, not a throw —
  // surface them through the session stream instead of crashing the host.
  child.on('error', (error) => {
    child.stdin?.destroy(error);
    child.stdout?.destroy(error);
  });
  return child;
}
