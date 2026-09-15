import { describe, expect, it } from 'vitest';
import { describeRouting, parseNodeMention } from '../src/routing';

const KNOWN = ['goose-office', 'dsh-local'];

describe('parseNodeMention (Layer 3: @slug routing)', () => {
  it('strips a registered slug mention from the first text block', () => {
    const decision = parseNodeMention(
      [{ type: 'text', text: '@goose-office check CI status please' }],
      KNOWN
    );
    expect(decision.slug).toBe('goose-office');
    expect(decision.blocks[0]).toEqual({ type: 'text', text: 'check CI status please' });
  });

  it('keeps text intact when the mention is not a registered slug (zero false positives)', () => {
    const blocks = [{ type: 'text', text: '@hello world is a normal prompt' }];
    expect(parseNodeMention(blocks, KNOWN)).toEqual({ slug: null, blocks });
  });

  it('ignores malformed mentions (no space after slug) and mid-sentence mentions', () => {
    expect(parseNodeMention([{ type: 'text', text: '@goose-office(no space)' }], KNOWN).slug).toBeNull();
    expect(parseNodeMention([{ type: 'text', text: 'plain @goose-office mid-sentence' }], KNOWN).slug).toBeNull();
  });

  it('leaves non-text-leading prompts and image-first prompts unrouted', () => {
    const blocks = [{ type: 'image', data: 'x' }, { type: 'text', text: '@goose-office hi' }];
    expect(parseNodeMention(blocks, KNOWN).slug).toBeNull();
  });
});

describe('describeRouting (Layer 3 discovery via description education)', () => {
  it('lists slugs and the convention', () => {
    expect(describeRouting(KNOWN)).toBe(
      'fleet nodes: goose-office, dsh-local — prefix prompts with @<slug> to target a node'
    );
  });
  it('handles an empty registry', () => {
    expect(describeRouting([])).toBe('no fleet nodes registered');
  });
});
