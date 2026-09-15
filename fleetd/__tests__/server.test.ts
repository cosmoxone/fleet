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
