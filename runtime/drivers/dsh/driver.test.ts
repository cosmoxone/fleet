import { describe, it, expect } from 'vitest';
import { dshDriver } from './driver';
import { resolveDriver, resolveDriverForNode, listDriverOptions } from '../index';
import { gooseDriver } from '../goose/driver';

const offlineNode = {
  id: 'n1',
  name: 'offline',
  driver: 'dsh',
  url: 'http://127.0.0.1:9', // discard port: connection refused
  secret: 's',
};

describe('dshDriver', () => {
  it('declares ACP over WebSocket capabilities without local provisioning', () => {
    const caps = dshDriver.capabilities();
    expect(caps.protocol).toBe('acp');
    expect(caps.transports).toEqual(['http-websocket']);
    expect(caps.tlsCertificatePinning).toBe(true);
    expect(caps.localProvisioning).toBe(false);
    // F-2: standard ACP initialize face, degraded app surface
    // (single source: capabilities.json; details in capabilities.test.ts).
    expect(caps.initializeMeta).toBe('standard');
  });

  it('identifies as dsh', () => {
    expect(dshDriver.id).toBe('dsh');
    expect(dshDriver.displayName).toContain('DeepSeek Harness');
  });

  it('reports an unhealthy node without throwing', async () => {
    const report = await dshDriver.healthCheck(offlineNode);
    expect(report.ok).toBe(false);
    expect(report.detail).toBeTruthy();
  }, 10_000);
});

describe('driver registry', () => {
  it('resolves goose by default and for driverless nodes', () => {
    expect(resolveDriver(undefined).id).toBe('goose');
    expect(resolveDriverForNode({}).id).toBe('goose');
    expect(resolveDriverForNode({ driver: 'goose' }).id).toBe('goose');
  });

  it('resolves dsh for dsh nodes', () => {
    expect(resolveDriverForNode({ driver: 'dsh' }).id).toBe('dsh');
  });

  it('throws for unknown drivers', () => {
    expect(() => resolveDriver('nope')).toThrow(/unknown fleet driver/);
  });

  it('lists goose and dsh options', () => {
    expect(listDriverOptions().map((o) => o.id)).toEqual(['goose', 'dsh']);
    expect(gooseDriver.id).toBe('goose');
  });
});
