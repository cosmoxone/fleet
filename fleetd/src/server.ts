import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { loadBridgeNodes, findBridgeNode } from '../../bridge/src/nodes';
import { dispatchToNode, type TurnResult } from '../../bridge/src/dispatch';

/**
 * FLEET-HUB-001 M1 (first slice) — fleetd: the headless fleet kernel service.
 *
 * Loopback-only HTTP with token auth (contract mirroring the acp-ws bridge):
 *   GET  /status   — liveness + counters
 *   GET  /nodes    — registry listing (slug keys)
 *   POST /dispatch — {node, prompt, timeoutMs?} → TurnResult (same code path
 *                    the standalone bridge uses; permission answers stay
 *                    deny-first until the permission hub grows a face ④)
 *
 * The standalone bridge attaches to this when discovered (FLEETD_URL or the
 * discovery file) and falls back silently when fleetd is down — M1 acceptance.
 */

export interface FleetdCounters {
  dispatches: number;
  dispatchFailures: number;
  permissionDenies: number;
}

export interface FleetdOptions {
  settingsPath: string;
  /** Test seam: dispatch implementation override. */
  dispatchImpl?: (
    nodeKey: string,
    prompt: string,
    timeoutMs: number
  ) => Promise<TurnResult>;
  port?: number;
}

export interface FleetdHandle {
  server: Server;
  port: number;
  token: string;
  counters: FleetdCounters;
  close(): Promise<void>;
}

function readBody(req: IncomingMessage, limitBytes = 1 << 20): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(text),
  });
  res.end(text);
}

export function createFleetd(options: FleetdOptions): Promise<FleetdHandle> {
  const token = randomBytes(24).toString('hex');
  const counters: FleetdCounters = { dispatches: 0, dispatchFailures: 0, permissionDenies: 0 };
  const startedAt = new Date().toISOString();

  const runDispatch =
    options.dispatchImpl ??
    (async (nodeKey: string, prompt: string, timeoutMs: number) => {
      const node = findBridgeNode(options.settingsPath, nodeKey);
      if (!node) {
        throw new Error(`unknown fleet node: ${nodeKey}`);
      }
      return dispatchToNode(node, prompt, timeoutMs);
    });

  const server = createServer((req, res) => {
    void handle(req, res).catch((error) => {
      sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (req.headers['x-secret-key'] !== token) {
      sendJson(res, 401, { error: 'unauthorized' });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/status') {
      sendJson(res, 200, { ok: true, service: 'fleetd', version: '0.1.0', startedAt, counters });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/nodes') {
      sendJson(res, 200, { nodes: loadBridgeNodes(options.settingsPath) });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/dispatch') {
      const body = JSON.parse(await readBody(req)) as {
        node?: string;
        prompt?: string;
        timeoutMs?: number;
      };
      if (!body.node || typeof body.prompt !== 'string') {
        sendJson(res, 400, { error: 'node and prompt are required' });
        return;
      }
      counters.dispatches += 1;
      try {
        const result = await runDispatch(
          body.node,
          body.prompt,
          typeof body.timeoutMs === 'number' ? body.timeoutMs : 120_000
        );
        counters.permissionDenies += result.permissionRequests; // deny-first policy
        sendJson(res, 200, result);
      } catch (error) {
        counters.dispatchFailures += 1;
        sendJson(res, 502, { error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }
    sendJson(res, 404, { error: 'not found' });
  }

  return new Promise((resolve) => {
    server.listen(options.port ?? 0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({
        server,
        port,
        token,
        counters,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}
