import { describe, it, expect } from 'vitest';
import { staticBindingPolicy } from './policy';
import type { FleetNode } from './node';

const nodes: FleetNode[] = [
  { id: 'a', name: 'a', url: 'https://a:1', secret: 's' },
  { id: 'b', name: 'b', url: 'https://b:1', secret: 's' },
];

describe('staticBindingPolicy', () => {
  it('returns the node matching the bound id', () => {
    expect(staticBindingPolicy.selectNode('b', nodes)?.id).toBe('b');
  });

  it('returns null without a binding', () => {
    expect(staticBindingPolicy.selectNode(null, nodes)).toBeNull();
  });

  it('returns null for an id that no longer exists', () => {
    expect(staticBindingPolicy.selectNode('gone', nodes)).toBeNull();
  });
});
