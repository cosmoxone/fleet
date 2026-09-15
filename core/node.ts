import { normalizeAcpHttpBaseUrl } from './url';

export interface FleetNode {
  id: string;
  name: string;
  url: string;
  secret: string;
  certFingerprint?: string;
  workingDir?: string;
  /** Backend driver id. Omitted means the default driver. */
  driver?: string;
  /**
   * stdio 节点（F-3）：要 spawn 的 ACP agent 命令（acpx 风格）。设置后
   * `url` 应为空——连接走进程 stdin/stdout 而非 WebSocket。
   * ssh 远端节点 = command 模板（如 `ssh host -- hermes acp`），零额外传输类型。
   */
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  /**
   * Machine-readable immutable slug (FLEET-NAMING-001). Optional for backward
   * compatibility: legacy nodes resolve a stable derived slug on read
   * (`fleetNodeSlug`); persisting happens on the next explicit save.
   */
  slug?: string;
}

export const DEFAULT_DRIVER_ID = 'goose';

export function effectiveDriverId(node: Pick<FleetNode, 'driver'>): string {
  return node.driver ?? DEFAULT_DRIVER_ID;
}

export type FleetNodeValidationError =
  | 'nameRequired'
  | 'urlProtocol'
  | 'urlBase'
  | 'urlFormat'
  | 'fingerprintRequiresHttps'
  | 'commandRequired'
  | 'commandAndUrlBothSet'
  | 'argsNotStrings'
  | 'envNotStrings';

export function validateFleetNode(node: FleetNode): FleetNodeValidationError | null {
  if (!node.name.trim()) {
    return 'nameRequired';
  }
  if (node.command !== undefined) {
    if (!node.command.trim()) {
      return 'commandRequired';
    }
    if (node.url.trim()) {
      return 'commandAndUrlBothSet';
    }
    if (node.args !== undefined && (!Array.isArray(node.args) || !node.args.every((a) => typeof a === 'string'))) {
      return 'argsNotStrings';
    }
    if (
      node.env !== undefined &&
      (typeof node.env !== 'object' || !Object.values(node.env).every((v) => typeof v === 'string'))
    ) {
      return 'envNotStrings';
    }
    return null;
  }
  if (!node.url.trim()) {
    return null;
  }
  try {
    const normalizedUrl = normalizeAcpHttpBaseUrl(node.url);
    const parsed = new URL(normalizedUrl);
    if (node.certFingerprint?.trim() && parsed.protocol !== 'https:') {
      return 'fingerprintRequiresHttps';
    }
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message.includes('http: or https:')) {
      return 'urlProtocol';
    }
    if (
      message.includes('base URL before /acp') ||
      message.includes('query parameters or fragments')
    ) {
      return 'urlBase';
    }
    return 'urlFormat';
  }
}

// ─── Node naming (FLEET-NAMING-001 v0.1) ─────────────────────────────────────

/** Reserved slugs that would collide with routing/CLI vocabulary. */
export const RESERVED_NODE_SLUGS: readonly string[] = [
  'new',
  'all',
  'nodes',
  'fleet',
  'local',
  'default',
  'agent',
  'serve',
];

const SLUG_MAX_LENGTH = 40;
const SLUG_PATTERN = /^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$/;

/**
 * Derives a slug suggestion from a display name: lowercase, fold anything
 * outside [a-z0-9] to '-', trim/collapse separators, cap at 40 chars,
 * prefix reserved words with 'n-'. Returns '' when nothing derivable
 * (pure CJK/symbolic names) — callers then require a hand-written slug
 * or generate a short id (N-D2).
 */
export function deriveNodeSlug(displayName: string): string {
  const folded = displayName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/g, '');
  if (!folded) {
    return '';
  }
  if (RESERVED_NODE_SLUGS.includes(folded)) {
    return `n-${folded}`.slice(0, SLUG_MAX_LENGTH);
  }
  return folded;
}

export function isValidNodeSlug(slug: string): boolean {
  return SLUG_PATTERN.test(slug) && !RESERVED_NODE_SLUGS.includes(slug);
}

export function isReservedNodeSlug(slug: string): boolean {
  return RESERVED_NODE_SLUGS.includes(slug);
}

/** Generates a short fallback slug for non-derivable names (N-D2). */
export function generateNodeSlug(): string {
  const suffix = Math.random().toString(36).slice(2, 8);
  return `n-${suffix}`;
}

/**
 * Resolves the effective slug: persisted slug wins; legacy nodes derive
 * lazily from the display name (stable: same name → same slug), falling
 * back to '' when not derivable — consumers should treat '' as
 * "awaiting explicit slug" rather than synthesizing silently.
 */
export function fleetNodeSlug(node: Pick<FleetNode, 'slug' | 'name'>): string {
  return node.slug ?? deriveNodeSlug(node.name);
}

/** Canonical cross-face name: `fleet/<slug>` (ACP routing, audit, bridge). */
export function fleetCanonicalName(slug: string): string {
  return `fleet/${slug}`;
}

/** acpx registry key form: `fleet-<slug>` (JSON5 keys / command args). */
export function acpxKeyForSlug(slug: string): string {
  return `fleet-${slug}`;
}
