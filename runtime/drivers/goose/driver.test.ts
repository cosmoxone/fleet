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
    expect(gooseDriver.capabilities()).toEqual({
      protocol: 'acp',
      transports: ['http-websocket'],
      tlsCertificatePinning: true,
      localProvisioning: true,
    });
  });

  it('reports an unhealthy node without throwing', async () => {
    const report = await gooseDriver.healthCheck(offlineNode);
    expect(report.ok).toBe(false);
    expect(report.detail).toBeTruthy();
  }, 10_000);
});
