import { describe, expect, it } from 'vitest';
import type { DriverCapabilities } from '../../core/driver';
import { gooseDriver } from './goose/driver';
import { dshDriver } from './dsh/driver';
import {
  DRIVER_CAPABILITY_ENTRIES,
  appCapabilities,
  driverCapabilityEntry,
  validateCapabilities,
} from './capabilities';
import { DRIVERS } from './index';

describe('capabilities.json single source (FLEET-CATALOG-001)', () => {
  it('declares exactly the registered drivers', () => {
    expect(Object.keys(DRIVER_CAPABILITY_ENTRIES).sort()).toEqual(['dsh', 'goose', 'stdio']);
  });

  it('stdio (F-3) declares the spawned-process surface and hides from desktop shell', () => {
    const entry = DRIVER_CAPABILITY_ENTRIES.stdio!;
    expect(entry.capabilities.transports).toEqual(['stdio']);
    expect(entry.capabilities.desktopShell).toBe(false);
    expect(entry.capabilities.initializeMeta).toBe('standard');
    expect(appCapabilities(entry.capabilities).reconnectPolicy).toBe('fresh-session');
  });

  it('drivers read capabilities from the JSON source', () => {
    expect(gooseDriver.capabilities()).toEqual(driverCapabilityEntry('goose').capabilities);
    expect(dshDriver.capabilities()).toEqual(driverCapabilityEntry('dsh').capabilities);
  });

  it('every registered driver has a declaration (registration consistency)', () => {
    // Adding a driver without a capabilities.json entry must fail loudly
    // (listDriverOptions reads display names from the JSON).
    expect([...DRIVERS.keys()].sort()).toEqual(Object.keys(DRIVER_CAPABILITY_ENTRIES).sort());
    for (const driverId of DRIVERS.keys()) {
      expect(() => driverCapabilityEntry(driverId)).not.toThrow();
    }
  });

  it('goose declares the goose-full surface', () => {
    const app = appCapabilities(driverCapabilityEntry('goose').capabilities);
    expect(app.sessionList).toBe(true);
    expect(app.sessionResume).toBe(true);
    expect(app.onboardingGuard).toBe(true);
    expect(app.providers).toBe(true);
    expect(app.cancel).toBe('request');
    expect(app.reconnectPolicy).toBe('resume');
    expect(app.permissionSurface).toBe('acp-standard');
    expect(app.modelLabel).toBeNull();
  });

  it('dsh declares the rc.2 degradation facts (D7 matrix + 5B findings)', () => {
    const entry = driverCapabilityEntry('dsh');
    expect(entry.capabilities.initializeMeta).toBe('standard');
    expect(entry.capabilities.localProvisioning).toBe(false);
    const app = appCapabilities(entry.capabilities);
    expect(app.sessionList).toBe(false);
    expect(app.sessionResume).toBe(false);
    expect(app.onboardingGuard).toBe(false);
    expect(app.providers).toBe(false);
    expect(app.recipes).toBe(false);
    expect(app.schedules).toBe(false);
    expect(app.mcpApps).toBe(false);
    expect(app.cancel).toBe('notify-noop');
    expect(app.reconnectPolicy).toBe('fresh-session');
    expect(app.permissionSurface).toBe('silent-policy');
    expect(app.modelLabel).toBe('remote (node-configured)');
    expect(app.notes.length).toBeGreaterThan(0);
  });
});

describe('appCapabilities compat default (absent fields = goose-full)', () => {
  it('treats a bare capability block as goose-full', () => {
    const bare: DriverCapabilities = {
      protocol: 'acp',
      transports: ['http-websocket'],
      tlsCertificatePinning: true,
      localProvisioning: true,
    };
    const app = appCapabilities(bare);
    expect(app.sessionList).toBe(true);
    expect(app.onboardingGuard).toBe(true);
    expect(app.cancel).toBe('request');
    expect(app.reconnectPolicy).toBe('resume');
    expect(app.permissionSurface).toBe('acp-standard');
    expect(app.notes).toEqual([]);
  });
});

describe('validateCapabilities structural checks', () => {
  const base = {
    protocol: 'acp',
    transports: ['http-websocket'],
    tlsCertificatePinning: true,
    localProvisioning: false,
  };

  it('accepts a minimal valid declaration', () => {
    expect(() => validateCapabilities('x', { ...base })).not.toThrow();
  });

  it('rejects unknown protocol, transports and enum values', () => {
    expect(() => validateCapabilities('x', { ...base, protocol: 'mcp' })).toThrow(/protocol/);
    expect(() =>
      validateCapabilities('x', { ...base, transports: ['carrier-pigeon'] })
    ).toThrow(/transports/);
    expect(() =>
      validateCapabilities('x', { ...base, app: { cancel: 'maybe' } })
    ).toThrow(/cancel/);
    expect(() =>
      validateCapabilities('x', { ...base, app: { reconnectPolicy: 'reboot' } })
    ).toThrow(/reconnectPolicy/);
    expect(() =>
      validateCapabilities('x', { ...base, app: { permissionSurface: 'ask-always' } })
    ).toThrow(/permissionSurface/);
  });

  it('rejects wrong scalar types', () => {
    expect(() =>
      validateCapabilities('x', { ...base, tlsCertificatePinning: 'yes' })
    ).toThrow(/tlsCertificatePinning/);
    expect(() =>
      validateCapabilities('x', { ...base, app: { providers: 1 } })
    ).toThrow(/providers/);
    expect(() => validateCapabilities('x', { ...base, app: { notes: 'nope' } })).toThrow(/notes/);
    expect(() => validateCapabilities('x', null)).toThrow(/object/);
  });
});
