import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  addNode,
  listNodes,
  loadFleetSettings,
  removeNode,
  renameNode,
  saveFleetSettings,
  updateNodeSecret,
  type FleetSettingsStore,
} from './registry';
import type { FleetNode } from './node';

const baseNode = {
  name: 'dev-box',
  url: 'https://192.168.1.11:3284',
  secret: 'secret-1',
};

describe('registry CRUD', () => {
  let settings: FleetSettingsStore;

  beforeEach(() => {
    settings = {};
  });

  it('adds a node with a generated id', () => {
    const added = addNode(settings, baseNode);
    expect(added.id).toBeTruthy();
    expect(listNodes(settings)).toEqual([added]);
  });

  it('honors an explicit id and optional fields', () => {
    const added = addNode(settings, {
      ...baseNode,
      id: 'node-9',
      certFingerprint: 'AA:BB',
      workingDir: '/ws',
      driver: 'goose',
    });
    expect(added).toMatchObject({ id: 'node-9', certFingerprint: 'AA:BB', workingDir: '/ws' });
  });

  it('rejects an invalid node', () => {
    expect(() => addNode(settings, { ...baseNode, name: ' ' })).toThrow('nameRequired');
    expect(listNodes(settings)).toEqual([]);
  });

  it('renames, rotates the secret and removes by id', () => {
    const added = addNode(settings, baseNode);
    expect(renameNode(settings, added.id, 'ci-box')).toBe(true);
    expect(updateNodeSecret(settings, added.id, 's2')).toBe(true);
    expect(listNodes(settings)[0]).toMatchObject({ name: 'ci-box', secret: 's2' });
    expect(removeNode(settings, added.id)).toBe(true);
    expect(listNodes(settings)).toEqual([]);
  });

  it('returns false for unknown ids', () => {
    addNode(settings, baseNode);
    expect(renameNode(settings, 'missing', 'x')).toBe(false);
    expect(updateNodeSecret(settings, 'missing', 'x')).toBe(false);
    expect(removeNode(settings, 'missing')).toBe(false);
  });
});

describe('registry persistence', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'fleet-registry-'));
    file = path.join(dir, 'settings.json');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('round-trips nodes through settings.json and preserves foreign keys', () => {
    const settings: FleetSettingsStore = { theme: 'dark' };
    const added = addNode(settings, baseNode);
    saveFleetSettings(file, settings);

    const loaded = loadFleetSettings(file);
    expect(listNodes(loaded)).toEqual([added]);
    expect(loaded.theme).toBe('dark');
  });
});
