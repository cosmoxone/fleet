import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { findBridgeNode, loadBridgeNodes } from '../src/nodes';

function fixtureSettings(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'fleet-bridge-'));
  const file = path.join(dir, 'settings.json');
  writeFileSync(
    file,
    JSON.stringify({
      externalBackends: [
        {
          id: 'n-dsh',
          name: 'dsh-local (minimax M3)',
          url: 'http://127.0.0.1:3284',
          secret: 'tok',
          driver: 'dsh',
        },
        {
          id: 'n-goose',
          name: 'office goose',
          url: 'https://10.0.0.4:41999',
          secret: 'tok2',
        },
      ],
    })
  );
  return file;
}

describe('bridge nodes (F-2 slugs as machine keys)', () => {
  it('lists nodes with derived slugs and effective drivers', () => {
    const nodes = loadBridgeNodes(fixtureSettings());
    expect(nodes).toHaveLength(2);
    const dsh = nodes.find((n) => n.id === 'n-dsh')!;
    expect(dsh.slug).toBe('dsh-local-minimax-m3');
    expect(dsh.driver).toBe('dsh');
    const goose = nodes.find((n) => n.id === 'n-goose')!;
    expect(goose.slug).toBe('office-goose');
    expect(goose.driver).toBe('goose'); // default when omitted
  });

  it('resolves by slug first, then id', () => {
    const file = fixtureSettings();
    expect(findBridgeNode(file, 'office-goose')?.id).toBe('n-goose');
    expect(findBridgeNode(file, 'n-dsh')?.id).toBe('n-dsh');
    expect(findBridgeNode(file, 'nope')).toBeUndefined();
  });
});
