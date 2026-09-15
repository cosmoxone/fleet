#!/usr/bin/env node
/**
 * F-2 (FLEET-CATALOG-001): generate the app-side mirror of
 * runtime/drivers/capabilities.json.
 *
 * The Electron app must not import core/runtime across the snapshot
 * boundary, so it consumes this generated module instead. CI re-runs the
 * generator and fails on `git diff` — hand-editing the output is forbidden.
 *
 * Usage: node scripts/gen-driver-capabilities.mjs [--check]
 *   --check: exit 1 when the committed artifact is stale (used by CI).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(REPO_ROOT, 'runtime/drivers/capabilities.json');
const TARGET = path.join(REPO_ROOT, 'app/src/utils/generated/driverCapabilities.ts');

const data = JSON.parse(readFileSync(SOURCE, 'utf-8'));

const body = JSON.stringify(data, null, 2);

const output = `// AUTO-GENERATED from runtime/drivers/capabilities.json — DO NOT EDIT.
// Regenerate with: node scripts/gen-driver-capabilities.mjs
// CI verifies this artifact is in sync (drift = red build).
// Source of truth + semantics: docs/features/driver-capability-catalog-design.md (FLEET-CATALOG-001).

export type FleetDriverTransport = 'http-websocket' | 'stdio';
export type FleetInitializeMeta = 'goose' | 'standard';
export type FleetCancelMode = 'request' | 'notify-noop';
export type FleetReconnectPolicy = 'resume' | 'fresh-session';
export type FleetPermissionSurface = 'acp-standard' | 'silent-policy';

export interface FleetDriverAppCapabilities {
  sessionList?: boolean;
  sessionResume?: boolean;
  sessionRename?: boolean;
  onboardingGuard?: boolean;
  providers?: boolean;
  recipes?: boolean;
  schedules?: boolean;
  mcpApps?: boolean;
  steer?: boolean;
  cancel?: FleetCancelMode;
  reconnectPolicy?: FleetReconnectPolicy;
  permissionSurface?: FleetPermissionSurface;
  modelLabel?: string | null;
  notes?: readonly string[];
}

export interface FleetDriverCapabilities {
  protocol: 'acp';
  transports: readonly FleetDriverTransport[];
  tlsCertificatePinning: boolean;
  localProvisioning: boolean;
  initializeMeta?: FleetInitializeMeta;
  app?: FleetDriverAppCapabilities;
}

export interface FleetDriverCapabilityEntry {
  displayName: string;
  capabilities: FleetDriverCapabilities;
}

/** Driver id -> declaration (registered drivers only). */
export const DRIVER_CAPABILITY_ENTRIES = ${body} as const;

export type FleetDriverId = keyof typeof DRIVER_CAPABILITY_ENTRIES;

/**
 * App-layer flags with the documented compat default: absent field (or whole
 * app block) = goose-full. Mirrors runtime/drivers/capabilities.ts.
 */
export function fleetAppCapabilities(caps: FleetDriverCapabilities): {
  sessionList: boolean;
  sessionResume: boolean;
  sessionRename: boolean;
  onboardingGuard: boolean;
  providers: boolean;
  recipes: boolean;
  schedules: boolean;
  mcpApps: boolean;
  steer: boolean;
  cancel: FleetCancelMode;
  reconnectPolicy: FleetReconnectPolicy;
  permissionSurface: FleetPermissionSurface;
  modelLabel: string | null;
  notes: readonly string[];
} {
  const app = caps.app ?? {};
  return {
    sessionList: app.sessionList ?? true,
    sessionResume: app.sessionResume ?? true,
    sessionRename: app.sessionRename ?? true,
    onboardingGuard: app.onboardingGuard ?? true,
    providers: app.providers ?? true,
    recipes: app.recipes ?? true,
    schedules: app.schedules ?? true,
    mcpApps: app.mcpApps ?? true,
    steer: app.steer ?? true,
    cancel: app.cancel ?? 'request',
    reconnectPolicy: app.reconnectPolicy ?? 'resume',
    permissionSurface: app.permissionSurface ?? 'acp-standard',
    modelLabel: app.modelLabel ?? null,
    notes: app.notes ?? [],
  };
}
`;

const check = process.argv.includes('--check');
if (check) {
  const committed = readFileSync(TARGET, 'utf-8');
  if (committed !== output) {
    console.error(
      'app/src/utils/generated/driverCapabilities.ts is stale. Run: node scripts/gen-driver-capabilities.mjs'
    );
    process.exit(1);
  }
  console.log('driverCapabilities.ts is in sync.');
} else {
  mkdirSync(path.dirname(TARGET), { recursive: true });
  writeFileSync(TARGET, output);
  console.log(`generated ${path.relative(REPO_ROOT, TARGET)}`);
}
