import { describe, expect, it } from 'vitest';
import {
  RESERVED_NODE_SLUGS,
  acpxKeyForSlug,
  deriveNodeSlug,
  fleetCanonicalName,
  fleetNodeSlug,
  generateNodeSlug,
  isReservedNodeSlug,
  isValidNodeSlug,
  type FleetNode,
} from '../node';
import { addNode, type FleetSettingsStore } from '../registry';

function baseNode(overrides: Partial<FleetNode> = {}): Omit<FleetNode, 'id'> {
  return {
    name: 'dsh-local (minimax M3)',
    url: 'http://127.0.0.1:3284',
    secret: 's3cret',
    ...overrides,
  };
}

describe('deriveNodeSlug (FLEET-NAMING-001)', () => {
  it('folds display names into slugs', () => {
    expect(deriveNodeSlug('dsh-local (minimax M3)')).toBe('dsh-local-minimax-m3');
    expect(deriveNodeSlug('  Home -- Goose ')).toBe('home-goose');
    expect(deriveNodeSlug('A_B/C')).toBe('a-b-c');
  });

  it('caps length at 40 and trims trailing separators', () => {
    const long = 'x'.repeat(60);
    expect(deriveNodeSlug(long)).toHaveLength(40);
  });

  it('prefixes reserved words', () => {
    expect(deriveNodeSlug('New')).toBe('n-new');
    expect(deriveNodeSlug('FLEET')).toBe('n-fleet');
  });

  it('returns empty for non-derivable (pure CJK) names', () => {
    expect(deriveNodeSlug('家里的 goose')).toBe('goose');
    expect(deriveNodeSlug('家里的')).toBe('');
  });
});

describe('slug validation & helpers', () => {
  it('accepts well-formed slugs and rejects malformed/reserved ones', () => {
    expect(isValidNodeSlug('goose-home')).toBe(true);
    expect(isValidNodeSlug('a')).toBe(true);
    expect(isValidNodeSlug('-bad')).toBe(false);
    expect(isValidNodeSlug('bad-')).toBe(false);
    expect(isValidNodeSlug('has space')).toBe(false);
    expect(isValidNodeSlug('x'.repeat(41))).toBe(false);
    expect(isReservedNodeSlug('serve')).toBe(true);
    expect(isValidNodeSlug('serve')).toBe(false);
    expect(RESERVED_NODE_SLUGS).toContain('nodes');
  });

  it('generates short fallback slugs', () => {
    expect(generateNodeSlug()).toMatch(/^n-[a-z0-9]{6}$/);
  });

  it('derives canonical and acpx key forms', () => {
    expect(fleetCanonicalName('goose-home')).toBe('fleet/goose-home');
    expect(acpxKeyForSlug('goose-home')).toBe('fleet-goose-home');
  });

  it('fleetNodeSlug: persisted wins, legacy derives lazily', () => {
    expect(fleetNodeSlug({ name: 'Anything', slug: 'pinned' })).toBe('pinned');
    expect(fleetNodeSlug({ name: 'dsh-local (minimax M3)' })).toBe('dsh-local-minimax-m3');
    expect(fleetNodeSlug({ name: '家里的' })).toBe('');
  });
});

describe('registry slug rules (N-D1: duplicates fail loudly)', () => {
  function store(): FleetSettingsStore {
    return {};
  }

  it('persists a derived slug on add', () => {
    const s = store();
    const added = addNode(s, baseNode());
    expect(added.slug).toBe('dsh-local-minimax-m3');
  });

  it('accepts an explicit valid slug', () => {
    const s = store();
    const added = addNode(s, baseNode({ name: '家里的 goose', slug: 'goose-home' }));
    expect(added.slug).toBe('goose-home');
  });

  it('generates a short id for non-derivable names without explicit slug', () => {
    const s = store();
    const added = addNode(s, baseNode({ name: '家里的' }));
    expect(added.slug).toMatch(/^n-[a-z0-9]{6}$/);
  });

  it('rejects duplicate effective slugs (including legacy-derived ones)', () => {
    const s = store();
    addNode(s, baseNode());
    expect(() => addNode(s, baseNode({ name: 'dsh-local (minimax M3)', url: 'http://127.0.0.1:3285' }))).toThrow(
      /already used/
    );
    expect(() => addNode(s, baseNode({ slug: 'dsh-local-minimax-m3' }))).toThrow(/already used/);
  });

  it('rejects invalid slugs with a descriptive error', () => {
    const s = store();
    expect(() => addNode(s, baseNode({ slug: 'Bad Slug' }))).toThrow(/invalid fleet node slug/);
    expect(() => addNode(s, baseNode({ slug: 'serve' }))).toThrow(/invalid fleet node slug/);
  });
});
