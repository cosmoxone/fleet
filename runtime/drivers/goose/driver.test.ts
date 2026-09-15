import { describe, it, expect } from 'vitest';
import { gooseDriver } from './driver';

const offlineNode = {
  id: 'n1',
  name: 'offline',
  url: 'http://127.0.0.1:9', // discard port: connection refused
  secret: 's',
};

describe('gooseDriver', () => {
  it('declares ACP over WebSocket capabilities', () => {
    const caps = gooseDriver.capabilities();
    expect(caps.protocol).toBe('acp');
    expect(caps.transports).toEqual(['http-websocket']);
    expect(caps.tlsCertificatePinning).toBe(true);
    expect(caps.localProvisioning).toBe(true);
    // F-2: app-layer surface is goose-full (single source: capabilities.json).
    expect(caps.initializeMeta).toBe('goose');
  });

  it('reports an unhealthy node without throwing', async () => {
    const report = await gooseDriver.healthCheck(offlineNode);
    expect(report.ok).toBe(false);
    expect(report.detail).toBeTruthy();
  }, 10_000);
});
