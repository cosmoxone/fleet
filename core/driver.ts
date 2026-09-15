import type { FleetNode } from './node';

export interface DriverCapabilities {
  protocol: 'acp';
  transports: readonly ('http-websocket' | 'stdio')[];
  tlsCertificatePinning: boolean;
  localProvisioning: boolean;
  /** Does initialize carry goose `_meta` capabilities? c2 acpConnection split, made explicit. */
  initializeMeta?: 'goose' | 'standard';
  /**
   * Can the Electron desktop shell drive this driver today? stdio spawns are
   * runtime/CLI-only until the loopback materialization lands (F-3 后续) —
   * hides the entry from the app dropdown without splitting the registry.
   */
  desktopShell?: boolean;
  app?: DriverAppCapabilities;
}

/**
 * Application-layer capability surface (FLEET-CATALOG-001 / F-2).
 * Every field is optional; an absent `app` block means "goose-full" —
 * the documented backward-compat default. Sources of truth for the
 * declared values: dsh-harness-driver.md §5.5 (D7 matrix), 5B
 * acceptance findings (c4 onboarding guard, reconnectPolicy).
 */
export interface DriverAppCapabilities {
  /** session/list + session sidebar recent-items face. dsh rc.2: false. */
  sessionList?: boolean;
  /** session/load / restore face. dsh rc.2: false (one session per connection). */
  sessionResume?: boolean;
  sessionRename?: boolean;
  /** OnboardingGuard provider check applies. Non-goose: false (c4). */
  onboardingGuard?: boolean;
  /** Model/provider picker face (goose *_unstable providers). dsh: false. */
  providers?: boolean;
  recipes?: boolean;
  schedules?: boolean;
  mcpApps?: boolean;
  steer?: boolean;
  /** dsh rc.2 answers session/cancel with -32601: UI hides/degrades the stop action. */
  cancel?: 'request' | 'notify-noop';
  /** Post-reconnect session strategy. dsh: fresh-session (5B finding F-2). */
  reconnectPolicy?: 'resume' | 'fresh-session';
  /** Permission request surface. dsh cordis approval.policy=never: silent-policy. */
  permissionSurface?: 'acp-standard' | 'silent-policy';
  /** Neutral model label for pickers when `providers` is false (fixes D-2 wording). */
  modelLabel?: string | null;
  /** i18n keys for degradation notes (translations stay in locale files). */
  notes?: string[];
}

export interface HealthReport {
  ok: boolean;
  detail?: string;
  agent?: { name?: string; version?: string };
  checkedAt: string;
}

/** Backend-agnostic ACP session; transport details stay inside the driver. */
export interface AcpSession {
  readonly driverId: string;
  readonly nodeId: string;
  request(method: string, params?: unknown): Promise<unknown>;
  close(): void;
}

/**
 * ACP driver contract. v1 minimal surface extracted from the verified goose
 * path; extend only when a second real backend joins (avoid speculative shape).
 */
export interface AcpDriver {
  readonly id: string;
  readonly displayName: string;
  capabilities(): DriverCapabilities;
  connect(node: FleetNode): AcpSession;
  healthCheck(node: FleetNode): Promise<HealthReport>;
  /** Optional: launch the node locally (goose: spawn `goose serve`). */
  provision?(node: FleetNode): Promise<void>;
}
