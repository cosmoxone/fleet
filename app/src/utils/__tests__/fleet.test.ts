import { describe, it, expect } from 'vitest';
import {
  buildFleetNodeSubmenu,
  FLEET_MENU_EMPTY_HINT,
  getFleetCspBackends,
  getFleetNodeBackend,
  validateFleetNode,
} from '../fleet';
import { defaultSettings, type FleetNodeConfig } from '../settings';

const node = (overrides: Partial<FleetNodeConfig> = {}): FleetNodeConfig => ({
  id: 'node-1',
  name: 'dev-box',
  url: 'https://192.168.1.11:3284',
  secret: 'secret-1',
  ...overrides,
});

describe('getFleetNodeBackend', () => {
  it('resolves a configured node into an external backend', () => {
    const settings = { ...defaultSettings, externalBackends: [node()] };
    const backend = getFleetNodeBackend(settings, 'node-1');
    expect(backend).toEqual({
      source: 'settings',
      url: 'https://192.168.1.11:3284',
      secret: 'secret-1',
      fleetNodeId: 'node-1',
      fleetNodeName: 'dev-box',
    });
  });

  it('carries optional fingerprint and working dir', () => {
    const settings = {
      ...defaultSettings,
      externalBackends: [node({ certFingerprint: 'AA:BB', workingDir: '/ws' })],
    };
    const backend = getFleetNodeBackend(settings, 'node-1');
    expect(backend?.certFingerprint).toBe('AA:BB');
    expect(backend?.workingDir).toBe('/ws');
  });

  it('returns null for an unknown id', () => {
    expect(getFleetNodeBackend(defaultSettings, 'missing')).toBeNull();
  });
});

describe('getFleetCspBackends', () => {
  it('maps every fleet node to an enabled backend config', () => {
    const settings = {
      ...defaultSettings,
      externalBackends: [node(), node({ id: 'node-2', url: 'http://10.0.0.2:3284' })],
    };
    const backends = getFleetCspBackends(settings);
    expect(backends).toHaveLength(2);
    expect(backends[0]).toMatchObject({ enabled: true, url: 'https://192.168.1.11:3284' });
    expect(backends[1]).toMatchObject({ enabled: true, url: 'http://10.0.0.2:3284' });
  });

  it('returns empty for no nodes', () => {
    expect(getFleetCspBackends(defaultSettings)).toEqual([]);
  });
});

describe('buildFleetNodeSubmenu', () => {
  it('builds one submenu item per node, labeled by name', () => {
    const opened: string[] = [];
    const submenu = buildFleetNodeSubmenu([node(), node({ id: 'n2', name: 'ci' })], (n) =>
      opened.push(n.id)
    );
    expect(submenu.label).toBe('New Chat on Node…');
    const items = submenu.submenu as { label: string; click: () => void }[];
    expect(items.map((i) => i.label)).toEqual(['dev-box', 'ci']);
    items[1].click();
    expect(opened).toEqual(['n2']);
  });

  it('falls back to the url when the name is empty', () => {
    const submenu = buildFleetNodeSubmenu([node({ name: '' })], () => {});
    const items = submenu.submenu as { label: string }[];
    expect(items[0].label).toBe('https://192.168.1.11:3284');
  });

  it('shows a disabled hint entry when no nodes are configured', () => {
    const submenu = buildFleetNodeSubmenu([], () => {});
    expect(submenu.enabled).toBe(false);
    const items = submenu.submenu as { label: string; enabled: boolean }[];
    expect(items).toHaveLength(1);
    expect(items[0].enabled).toBe(false);
    expect(items[0].label).toBe(FLEET_MENU_EMPTY_HINT);
  });
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
