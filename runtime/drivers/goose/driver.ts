import { spawn } from 'node:child_process';
import { client, methods, PROTOCOL_VERSION } from '@agentclientprotocol/sdk';
import { createWebSocketStream } from '@agentclientprotocol/sdk/experimental/ws-client';
import type { AcpDriver, AcpSession, DriverCapabilities, HealthReport } from '../../../core/driver';
import { acpWebSocketUrlFromHttpBase } from '../../../core/url';
import type { FleetNode } from '../../../core/node';

const HEALTH_CHECK_TIMEOUT_MS = 5000;
const DEFAULT_PORT = '3284';

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
      timer.unref();
    }),
  ]);
}

function connectSession(node: FleetNode): AcpSession {
  const wsUrl = acpWebSocketUrlFromHttpBase(node.url, node.secret);
  const app = client({ name: 'fleet' });
  const stream = createWebSocketStream(wsUrl, { protocols: [] });
  const connection = app.connect(stream);
  const agent = connection.agent as unknown as {
    request(method: string, params?: unknown): Promise<unknown>;
  };
  return {
    driverId: 'goose',
    nodeId: node.id,
    request: (method, params) => agent.request(method, params),
    close: () => connection.close(),
  };
}

export const gooseDriver: AcpDriver = {
  id: 'goose',
  displayName: 'goose (goose serve, ACP over WebSocket)',
  capabilities(): DriverCapabilities {
    return {
      protocol: 'acp',
      transports: ['http-websocket'],
      // The pinned fingerprint travels on the node; enforcement happens in the
      // Electron transport layer (see INTEGRATION.md contract 1).
      tlsCertificatePinning: true,
      localProvisioning: true,
    };
  },
  connect(node: FleetNode): AcpSession {
    return connectSession(node);
  },
  async healthCheck(node: FleetNode): Promise<HealthReport> {
    const session = connectSession(node);
    try {
      const init = (await withTimeout(
        session.request(methods.agent.initialize, {
          protocolVersion: PROTOCOL_VERSION,
          clientCapabilities: {},
          clientInfo: { name: 'fleet-health', version: '0.0.0' },
        }),
        HEALTH_CHECK_TIMEOUT_MS
      )) as { agentInfo?: { name?: string; version?: string } };
      return {
        ok: true,
        agent: { name: init.agentInfo?.name, version: init.agentInfo?.version },
        checkedAt: new Date().toISOString(),
      };
    } catch (error) {
      return {
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
        checkedAt: new Date().toISOString(),
      };
    } finally {
      session.close();
    }
  },
  async provision(node: FleetNode): Promise<void> {
    const url = new URL(node.url);
    const port = url.port || DEFAULT_PORT;
    const child = spawn('goose', ['serve', '--host', '0.0.0.0', '--port', port, '--tls'], {
      env: { ...process.env, GOOSE_SERVER__SECRET_KEY: node.secret },
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
  },
};
