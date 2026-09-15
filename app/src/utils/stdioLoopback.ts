import { createServer } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { randomBytes } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';

/**
 * F-3 follow-up — stdio loopback materialization (nf-board TunnelManager
 * pattern): a stdio fleet node (command/args) is exposed to the renderer as
 * an ordinary contract-1 WebSocket endpoint on loopback, so the shell needs
 * ZERO renderer changes to drive hermes/openclaw/local agents.
 *
 * Semantics mirror the dsh acp-ws bridge: every WS connection spawns a fresh
 * agent process and pipes ndjson both ways; process exit closes the socket.
 */

export interface StdioLoopbackNode {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  workingDir?: string;
}

export interface StdioLoopback {
  /** ws://127.0.0.1:<port>/acp?token=<token> — the lease acpUrl. */
  acpUrl: string;
  /** http://127.0.0.1:<port>/status — health surface base (token via header). */
  statusUrl: string;
  secret: string;
  close(): Promise<void>;
}

export function startStdioLoopback(node: StdioLoopbackNode): Promise<StdioLoopback> {
  const token = randomBytes(24).toString('hex');
  const children = new Set<ChildProcess>();
  const sockets = new Set<WebSocket>();

  const httpServer = createServer((req, res) => {
    // Health surface for checkBackendStatus (same shape as goose serve).
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const authorized =
      req.headers['x-secret-key'] === token || url.searchParams.get('token') === token;
    if (url.pathname === '/status' && authorized) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, service: 'stdio-loopback' }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  const wss = new WebSocketServer({ server: httpServer, path: '/acp' });

  wss.on('connection', (ws: WebSocket, req) => {
    const url = new URL(req.url ?? '/acp', 'http://127.0.0.1');
    if (url.searchParams.get('token') !== token) {
      ws.close(4401, 'unauthorized');
      return;
    }
    sockets.add(ws);

    let child: ChildProcess;
    try {
      child = spawn(node.command, node.args ?? [], {
        env: { ...process.env, ...node.env },
        stdio: ['pipe', 'pipe', 'inherit'],
        cwd: node.workingDir || undefined,
      });
    } catch (error) {
      console.error('[stdio-loopback] spawn failed:', error);
      ws.close(1011, 'spawn failed');
      return;
    }
    children.add(child);

    // Agent stdout → WS, preserving ndjson line framing across chunk boundaries.
    createInterface({ input: child.stdout! }).on('line', (line) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(line);
      }
    });

    ws.on('message', (data) => {
      const text = typeof data === 'string' ? data : Buffer.from(data as ArrayBuffer).toString('utf-8');
      if (text.trim()) {
        child.stdin?.write(text.trimEnd() + '\n');
      }
    });

    const teardown = () => {
      sockets.delete(ws);
      children.delete(child);
      child.kill();
    };
    ws.on('close', teardown);
    ws.on('error', teardown);
    child.on('exit', () => {
      sockets.delete(ws);
      children.delete(child);
      if (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING) {
        ws.close(1000, 'agent exited');
      }
    });
    child.on('error', (error) => {
      console.error('[stdio-loopback] agent process error:', error);
      ws.close(1011, 'agent process error');
    });
  });

  return new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(0, '127.0.0.1', () => {
      const address = httpServer.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({
        acpUrl: `ws://127.0.0.1:${port}/acp?token=${token}`,
        statusUrl: `http://127.0.0.1:${port}/status`,
        secret: token,
        close: () =>
          new Promise<void>((done) => {
            for (const ws of sockets) {
              ws.close(1001, 'loopback shutting down');
            }
            for (const child of children) {
              child.kill();
            }
            wss.close(() => httpServer.close(() => done()));
          }),
      });
    });
  });
}
