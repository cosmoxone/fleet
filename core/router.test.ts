import { describe, it, expect } from 'vitest';
import { allBackendConfigs, resolveNodeBackend } from './router';
import type { FleetNode } from './node';

const node = (overrides: Partial<FleetNode> = {}): FleetNode => ({
  id: 'node-1',
  name: 'dev-box',
  url: 'https://192.168.1.11:3284',
  secret: 'secret-1',
  ...overrides,
});

describe('resolveNodeBackend', () => {
  it('resolves a configured node into a backend connection', () => {
    const settings = { externalBackends: [node()] };
    expect(resolveNodeBackend(settings, 'node-1')).toEqual({
      source: 'settings',
      url: 'https://192.168.1.11:3284',
      secret: 'secret-1',
      fleetNodeId: 'node-1',
      fleetNodeName: 'dev-box',
    });
  });

  it('carries optional fingerprint and working dir', () => {
    const settings = {
      externalBackends: [node({ certFingerprint: 'AA:BB', workingDir: '/ws' })],
    };
    const backend = resolveNodeBackend(settings, 'node-1');
    expect(backend?.certFingerprint).toBe('AA:BB');
    expect(backend?.workingDir).toBe('/ws');
  });

  it('returns null for an unknown id', () => {
    expect(resolveNodeBackend({ externalBackends: [] }, 'missing')).toBeNull();
  });
});

describe('allBackendConfigs', () => {
  it('maps every fleet node to an enabled backend config', () => {
    const settings = {
      externalBackends: [node(), node({ id: 'node-2', url: 'http://10.0.0.2:3284' })],
    };
    const backends = allBackendConfigs(settings);
    expect(backends).toHaveLength(2);
    expect(backends[0]).toMatchObject({ enabled: true, url: 'https://192.168.1.11:3284' });
    expect(backends[1]).toMatchObject({ enabled: true, url: 'http://10.0.0.2:3284' });
  });

  it('returns empty for no nodes', () => {
    expect(allBackendConfigs({})).toEqual([]);
  });
});
