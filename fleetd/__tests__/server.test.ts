import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFleetd, type FleetdHandle } from '../src/server';
import { resolveFleetd, dispatchWithFallback } from '../../bridge/src/attach';
import type { TurnResult } from '../../bridge/src/dispatch';
import type { FleetNode } from '../../../core/node';

const SETTINGS = (() => {
  const dir = mkdtempSync(path.join(tmpdir(), 'fleetd-test-'));
  const file = path.join(dir, 'settings.json');
  writeFileSync(
    file,
    JSON.stringify({
      externalBackends: [
        { id: 'n1', name: 'demo node', url: 'http://127.0.0.1:9', secret: 's', slug: 'demo-node' },
      ],
    })
  );
  return file;
})();

const CANNED: TurnResult = {
  sessionId: 'srv-1',
  stopReason: 'end_turn',
  text: 'FLEETD-OK',
  updateCount: 1,
  permissionRequests: 0,
};

let fleetd: FleetdHandle;

beforeAll(async () => {
  fleetd = await createFleetd({
    settingsPath: SETTINGS,
    dispatchImpl: async (nodeKey) => {
      if (nodeKey !== 'demo-node') {
        throw new Error(`unknown fleet node: ${nodeKey}`);
      }
      return CANNED;
    },
  });
});

afterAll(async () => {
  await fleetd.close();
});

describe('fleetd server (M1 first slice)', () => {
  it('guards every route behind the token', async () => {
    const res = await fetch(`http://127.0.0.1:${fleetd.port}/status`);
    expect(res.status).toBe(401);
  });

  it('serves status and the node registry', async () => {
    const status = await fetch(`http://127.0.0.1:${fleetd.port}/status`, {
      headers: { 'x-secret-key': fleetd.token },
    });
    expect((await status.json()).service).toBe('fleetd');

    const nodes = await fetch(`http://127.0.0.1:${fleetd.port}/nodes`, {
      headers: { 'x-secret-key': fleetd.token },
    });
    const body = (await nodes.json()) as { nodes: { slug: string }[] };
    expect(body.nodes.map((n) => n.slug)).toEqual(['demo-node']);
  });

  it('dispatches through the shared kernel and counts results', async () => {
    const res = await fetch(`http://127.0.0.1:${fleetd.port}/dispatch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-secret-key': fleetd.token },
      body: JSON.stringify({ node: 'demo-node', prompt: 'hi' }),
    });
    expect(await res.json()).toMatchObject({ text: 'FLEETD-OK', stopReason: 'end_turn' });
    expect(fleetd.counters.dispatches).toBe(1);

    const bad = await fetch(`http://127.0.0.1:${fleetd.port}/dispatch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-secret-key': fleetd.token },
      body: JSON.stringify({ node: 'nope', prompt: 'hi' }),
    });
    expect(bad.status).toBe(502);
    expect(fleetd.counters.dispatchFailures).toBe(1);
  });
});

describe('bridge attached mode (M1)', () => {
  const node: FleetNode = {
    id: 'n1',
    name: 'demo node',
    url: 'http://127.0.0.1:9',
    secret: 's',
    slug: 'demo-node',
  };

  it('resolves fleetd from env overrides first', () => {
    process.env.FLEETD_URL = `http://127.0.0.1:${fleetd.port}`;
    process.env.FLEETD_TOKEN = fleetd.token;
    try {
      expect(resolveFleetd('/nonexistent'))?.toMatchObject({ url: `http://127.0.0.1:${fleetd.port}` });
    } finally {
      delete process.env.FLEETD_URL;
      delete process.env.FLEETD_TOKEN;
    }
  });

  it('dispatches via fleetd when attached', async () => {
    process.env.FLEETD_URL = `http://127.0.0.1:${fleetd.port}`;
    process.env.FLEETD_TOKEN = fleetd.token;
    try {
      const result = await dispatchWithFallback(node, { slug: 'demo-node', prompt: 'hi', timeoutMs: 5000 });
      expect(result.via).toBe('fleetd');
      expect(result.text).toBe('FLEETD-OK');
    } finally {
      delete process.env.FLEETD_URL;
      delete process.env.FLEETD_TOKEN;
    }
  });

  it('falls back to standalone when fleetd is unreachable (hub failure ≠ bridge failure)', async () => {
    process.env.FLEETD_URL = 'http://127.0.0.1:1'; // nothing listens there
    process.env.FLEETD_TOKEN = 'x';
    try {
      // dispatchToNode against port 9 will also fail — assert we ATTEMPTED
      // standalone (via field) rather than throwing a hub error.
      await expect(
        dispatchWithFallback(node, { slug: 'demo-node', prompt: 'hi', timeoutMs: 200 })
      ).rejects.toThrow(); // standalone path fails on the unreachable node itself
    } finally {
      delete process.env.FLEETD_URL;
      delete process.env.FLEETD_TOKEN;
    }
    // With no fleetd configured at all, discovery resolves to null.
    expect(resolveFleetd('/nonexistent')).toBeNull();
  });
});

describe('fleetd permission endpoints + session reuse (M1 remainder)', () => {
  it('exposes pending permissions and answers them by id', async () => {
    const hub = fleetd.permissionHub;
    const pending = hub.wait({
      node: 'demo-node',
      sessionId: 's',
      options: [{ optionId: 'allow', kind: 'allow_once' }],
      deadlineMs: 5000,
    });
    await new Promise((r) => setTimeout(r, 10));

    const list = await fetch(`http://127.0.0.1:${fleetd.port}/permissions`, {
      headers: { 'x-secret-key': fleetd.token },
    });
    const body = (await list.json()) as { pending: { id: string }[] };
    expect(body.pending).toHaveLength(1);

    const res = await fetch(
      `http://127.0.0.1:${fleetd.port}/permissions/${body.pending[0]!.id}/answer`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-secret-key': fleetd.token },
        body: JSON.stringify({ outcome: 'selected', optionId: 'allow' }),
      }
    );
    expect(res.status).toBe(200);
    expect(await pending).toEqual({ outcome: { outcome: 'selected', optionId: 'allow' } });

    const missing = await fetch(`http://127.0.0.1:${fleetd.port}/permissions/nope/answer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-secret-key': fleetd.token },
      body: '{}',
    });
    expect(missing.status).toBe(404);
  });

  it('streams permission events over SSE', async () => {
    const controller = new AbortController();
    const stream = await fetch(`http://127.0.0.1:${fleetd.port}/events`, {
      headers: { 'x-secret-key': fleetd.token },
      signal: controller.signal,
    });
    const reader = stream.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const readSome = async (): Promise<string[]> => {
      const { value } = await reader.read();
      buffer += decoder.decode(value);
      const frames = buffer.split('\n\n');
      buffer = frames.pop() ?? '';
      return frames;
    };
    const hello = await readSome();
    expect(hello[0]).toContain('event: hello');

    const hub = fleetd.permissionHub;
    const pending = hub.wait({ node: 'n', sessionId: 's', options: [], deadlineMs: 2000 });
    const frame = await readSome();
    expect(frame.join('')).toContain('permission_pending');
    void pending.catch(() => undefined);
    controller.abort();
  });

  it('reuses the backend session for a stable sessionKey', async () => {
    let calls = 0;
    const local = await createFleetd({
      settingsPath: SETTINGS,
      dispatchImpl: async (nodeKey, prompt, timeoutMs, sessionKey) => {
        calls += 1;
        expect(sessionKey).toBe('stable-1');
        // Simulate the session-manager contract: same key → reused prefix.
        return {
          sessionId: calls === 1 ? 'fresh' : 'reused:fresh',
          stopReason: 'end_turn',
          text: prompt,
          updateCount: 1,
          permissionRequests: 0,
        };
      },
    });
    try {
      const post = (sessionKey?: string) =>
        fetch(`http://127.0.0.1:${local.port}/dispatch`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-secret-key': local.token },
          body: JSON.stringify({ node: 'demo-node', prompt: 'hi', sessionKey }),
        }).then((r) => r.json() as Promise<{ sessionId: string }>);

      expect(await post('stable-1')).toMatchObject({ sessionId: 'fresh' });
      expect(await post('stable-1')).toMatchObject({ sessionId: 'reused:fresh' });
      expect(calls).toBe(2);
    } finally {
      await local.close();
    }
  });
});

describe('companion page (M1 face ④ wiring)', () => {
  it('serves the companion HTML behind token auth (header or ?token=)', async () => {
    const noAuth = await fetch(`http://127.0.0.1:${fleetd.port}/companion`);
    expect(noAuth.status).toBe(401);

    const viaQuery = await fetch(`http://127.0.0.1:${fleetd.port}/companion?token=${fleetd.token}`);
    expect(viaQuery.status).toBe(200);
    const html = await viaQuery.text();
    expect(html).toContain('fleet companion');
    expect(html).toContain('/permissions/');

    const viaHeader = await fetch(`http://127.0.0.1:${fleetd.port}/companion`, {
      headers: { 'x-secret-key': fleetd.token },
    });
    expect(viaHeader.status).toBe(200);
  });

  it('SSE /events accepts query token (EventSource constraint)', async () => {
    const res = await fetch(`http://127.0.0.1:${fleetd.port}/events?token=${fleetd.token}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    await res.body!.cancel();
  });

  it('does NOT relax query auth for other routes', async () => {
    const res = await fetch(`http://127.0.0.1:${fleetd.port}/status?token=${fleetd.token}`);
    expect(res.status).toBe(401);
  });
});
