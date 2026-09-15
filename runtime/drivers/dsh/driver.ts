import { client, methods, PROTOCOL_VERSION } from '@agentclientprotocol/sdk';
import { createWebSocketStream } from '@agentclientprotocol/sdk/experimental/ws-client';
import type { AcpDriver, AcpSession, DriverCapabilities, HealthReport } from '../../../core/driver';
import { acpWebSocketUrlFromHttpBase } from '../../../core/url';
import type { FleetNode } from '../../../core/node';
import { driverCapabilityEntry } from '../capabilities';

const HEALTH_CHECK_TIMEOUT_MS = 5000;

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
    driverId: 'dsh',
    nodeId: node.id,
    request: (method, params) => agent.request(method, params),
    close: () => connection.close(),
  };
}

/**
 * DeepSeek Harness (dsh) driver.
 *
 * dsh exposes ACP v1 over stdio (`dsh-acp-demo`); the dsh-fleet
 * `bridge/acp-ws.mjs` WebSocket bridge presents the same wire contract as
 * `goose serve` (/status + /acp?token= + non-upgrade 406 + TLS fingerprint),
 * so connect/healthCheck are isomorphic to the goose driver.
 *
 * Differences from goose (see docs/features/dsh-harness-driver.md):
 * - no goose-specific `_meta` extensions in initialize (D2);
 * - no local provisioning: nodes are deployed by dsh-fleet (scripts/containers);
 * - dsh-acp rc.2 has no session/list|resume|close and session/cancel is
 *   unimplemented (server returns -32601) — callers must degrade gracefully.
 */
export const dshDriver: AcpDriver = {
  id: 'dsh',
  displayName: 'DeepSeek Harness (dsh-acp-demo via acp-ws bridge)',
  capabilities(): DriverCapabilities {
    // Single source: runtime/drivers/capabilities.json (FLEET-CATALOG-001).
    // The pinned fingerprint travels on the node; enforcement happens in the
    // Electron transport layer (see INTEGRATION.md contract 1). The bridge
    // prints a `sha256/<base64>` fingerprint at startup, same format goose
    // serve uses.
    return driverCapabilityEntry('dsh').capabilities;
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
};
