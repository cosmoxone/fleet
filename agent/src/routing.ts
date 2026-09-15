/**
 * FLEET-HUB-001 M2-alt — hub-mode prompt routing (Layer 3, @slug mentions).
 *
 * Convention: the first text block may start with `@<slug> ` (slug must be a
 * REGISTERED node slug — anything else is treated as ordinary prompt text and
 * routed to the default node; zero false positives by construction).
 */

export type PromptBlock = { type: string; text?: string; [key: string]: unknown };

export interface RouteDecision {
  /** Target node slug; null = default node (no valid mention). */
  slug: string | null;
  /** Prompt blocks with the mention stripped from the first text block. */
  blocks: PromptBlock[];
}

const MENTION = /^@([a-z0-9][a-z0-9-]*)\s+/;

export function parseNodeMention(
  blocks: PromptBlock[],
  knownSlugs: readonly string[]
): RouteDecision {
  // Only the LEADING text block carries the mention (image-first prompts stay unrouted).
  const first = blocks[0];
  if (!first || first.type !== 'text' || typeof first.text !== 'string' || !first.text) {
    return { slug: null, blocks };
  }
  const match = MENTION.exec(first.text);
  if (!match || !knownSlugs.includes(match[1]!)) {
    return { slug: null, blocks };
  }
  const stripped = blocks.map((b) =>
    b === first ? { ...b, text: (b.text as string).slice(match[0].length) } : b
  );
  return { slug: match[1]!, blocks: stripped };
}

/** Education string embedded in acpx-export descriptions (Layer 3 discovery). */
export function describeRouting(slugs: readonly string[]): string {
  if (slugs.length === 0) {
    return 'no fleet nodes registered';
  }
  return `fleet nodes: ${slugs.join(', ')} — prefix prompts with @<slug> to target a node`;
}
