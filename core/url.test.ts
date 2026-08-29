import { describe, it, expect } from 'vitest';
import { acpWebSocketUrlFromHttpBase, normalizeAcpHttpBaseUrl } from './url';

describe('normalizeAcpHttpBaseUrl', () => {
  it('normalizes trailing slashes', () => {
    expect(normalizeAcpHttpBaseUrl('https://192.168.1.11:3284/')).toBe('https://192.168.1.11:3284');
  });

  it('rejects empty urls', () => {
    expect(() => normalizeAcpHttpBaseUrl('  ')).toThrow('required');
  });

  it('rejects non-http protocols', () => {
    expect(() => normalizeAcpHttpBaseUrl('ws://h:1')).toThrow('http: or https:');
  });

  it('rejects query parameters and fragments', () => {
    expect(() => normalizeAcpHttpBaseUrl('https://h:1?token=x')).toThrow(
      'query parameters or fragments'
    );
    expect(() => normalizeAcpHttpBaseUrl('https://h:1#frag')).toThrow(
      'query parameters or fragments'
    );
  });

  it('rejects urls that already include the /acp path', () => {
    expect(() => normalizeAcpHttpBaseUrl('https://h:1/acp')).toThrow('base URL before /acp');
  });
});

describe('acpWebSocketUrlFromHttpBase', () => {
  it('upgrades http to ws with token on /acp', () => {
    expect(acpWebSocketUrlFromHttpBase('http://127.0.0.1:41999', 'tok-1')).toBe(
      'ws://127.0.0.1:41999/acp?token=tok-1'
    );
  });

  it('upgrades https to wss', () => {
    expect(acpWebSocketUrlFromHttpBase('https://192.168.1.11:3284', 's')).toBe(
      'wss://192.168.1.11:3284/acp?token=s'
    );
  });

  it('preserves a path prefix before /acp', () => {
    expect(acpWebSocketUrlFromHttpBase('https://h:1/prefix', 's')).toBe(
      'wss://h:1/prefix/acp?token=s'
    );
  });

  it('url-encodes the token', () => {
    expect(acpWebSocketUrlFromHttpBase('http://h:1', 'a b&c')).toBe('ws://h:1/acp?token=a+b%26c');
  });
});
