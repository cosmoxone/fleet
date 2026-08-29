import { describe, it, expect } from 'vitest';
import { effectiveDriverId, validateFleetNode, type FleetNode } from './node';

const node = (overrides: Partial<FleetNode> = {}): FleetNode => ({
  id: 'node-1',
  name: 'dev-box',
  url: 'https://192.168.1.11:3284',
  secret: 'secret-1',
  ...overrides,
});

describe('validateFleetNode', () => {
  it('accepts a valid node', () => {
    expect(validateFleetNode(node())).toBeNull();
  });

  it('accepts an empty url', () => {
    expect(validateFleetNode(node({ url: '' }))).toBeNull();
  });

  it('requires a name', () => {
    expect(validateFleetNode(node({ name: '  ' }))).toBe('nameRequired');
  });

  it('rejects non-http protocols', () => {
    expect(validateFleetNode(node({ url: 'ftp://192.168.1.11:3284' }))).toBe('urlProtocol');
  });

  it('rejects urls with query parameters or fragments', () => {
    expect(validateFleetNode(node({ url: 'https://h:1?token=x' }))).toBe('urlBase');
    expect(validateFleetNode(node({ url: 'https://h:1#frag' }))).toBe('urlBase');
  });

  it('rejects urls that already include the /acp path', () => {
    expect(validateFleetNode(node({ url: 'https://192.168.1.11:3284/acp' }))).toBe('urlBase');
  });

  it('rejects malformed urls', () => {
    expect(validateFleetNode(node({ url: 'not a url' }))).toBe('urlFormat');
  });

  it('requires https when a fingerprint is pinned', () => {
    expect(
      validateFleetNode(node({ url: 'http://192.168.1.11:3284', certFingerprint: 'AA:BB' }))
    ).toBe('fingerprintRequiresHttps');
    expect(
      validateFleetNode(node({ url: 'https://192.168.1.11:3284', certFingerprint: 'AA:BB' }))
    ).toBeNull();
  });
});

describe('effectiveDriverId', () => {
  it('defaults to goose when the driver field is absent', () => {
    expect(effectiveDriverId(node())).toBe('goose');
  });

  it('returns the explicit driver id', () => {
    expect(effectiveDriverId(node({ driver: 'deepseek-harness' }))).toBe('deepseek-harness');
  });
});
