import { describe, expect, it } from 'vitest';
import { buildAcpxExport } from '../src/export';

const NODES = [
  { id: 'n1', name: 'goose office', driver: 'goose', url: 'http://a:1', slug: 'goose-office' },
  { id: 'n2', name: 'dsh local', driver: 'dsh', url: 'http://b:2', slug: 'dsh-local' },
];

describe('acpx-export (fleet as acpx producer)', () => {
  it('emits one passthrough entry per node plus the hub entry', () => {
    const out = buildAcpxExport(NODES, { tsxBin: '/bin/tsx', mainTs: '/repo/agent/src/main.ts' });
    expect(Object.keys(out).sort()).toEqual(['fleet-dsh-local', 'fleet-goose-office', 'fleet-hub']);
    expect(out['fleet-goose-office']).toEqual({
      command: '/bin/tsx',
      args: ['/repo/agent/src/main.ts', 'agent', '--node', 'goose-office'],
      description: 'Fleet node passthrough: goose office (driver goose, http://a:1)',
    });
  });

  it('hub description teaches the @slug convention (Layer 3 discovery)', () => {
    const out = buildAcpxExport(NODES, { tsxBin: '/bin/tsx', mainTs: '/repo/agent/src/main.ts' });
    expect(out['fleet-hub'].description).toContain('@<slug>');
    expect(out['fleet-hub'].description).toContain('goose-office, dsh-local');
    expect(out['fleet-hub'].args).toEqual(['/repo/agent/src/main.ts', 'agent']);
  });

  it('emits nothing for an empty registry', () => {
    expect(buildAcpxExport([], { tsxBin: '/x', mainTs: '/y' })).toEqual({});
  });
});
