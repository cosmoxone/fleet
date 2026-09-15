import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DriverAppCapabilities, DriverCapabilities } from '../../core/driver';

/**
 * Single source of truth for driver capability declarations
 * (FLEET-CATALOG-001 / F-2): `runtime/drivers/capabilities.json`.
 *
 * The JSON is hand-editable and machine-validated (see `validateCapabilities`);
 * the Electron app consumes a generated mirror
 * (`app/src/utils/generated/driverCapabilities.ts`, emitted by
 * `scripts/gen-driver-capabilities.mjs`) because the app must not import
 * core/runtime across the snapshot boundary. CI re-runs the generator and
 * fails on drift — hand-editing the generated file is forbidden.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface DriverCapabilityEntry {
  displayName: string;
  capabilities: DriverCapabilities;
}

const TRANSPORTS = ['http-websocket', 'stdio'] as const;
const CANCELS = ['request', 'notify-noop'] as const;
const RECONNECT_POLICIES = ['resume', 'fresh-session'] as const;
const PERMISSION_SURFACES = ['acp-standard', 'silent-policy'] as const;
const INIT_META = ['goose', 'standard'] as const;

function isOneOf<T extends readonly string[]>(value: unknown, allowed: T): value is T[number] {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

function booleanOrUndefined(value: unknown, field: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'boolean') {
    throw new Error(`capabilities.json: ${field} must be a boolean`);
  }
  return value;
}

/** Structural validation for one driver's declared capabilities. */
export function validateCapabilities(
  driverId: string,
  raw: unknown
): asserts raw is DriverCapabilities {
  if (raw === null || typeof raw !== 'object') {
    throw new Error(`capabilities.json: ${driverId}.capabilities must be an object`);
  }
  const caps = raw as Record<string, unknown>;

  if (caps.protocol !== 'acp') {
    throw new Error(`capabilities.json: ${driverId}.protocol must be "acp"`);
  }
  if (
    !Array.isArray(caps.transports) ||
    caps.transports.length === 0 ||
    !caps.transports.every((t) => isOneOf(t, TRANSPORTS))
  ) {
    throw new Error(
      `capabilities.json: ${driverId}.transports must be a non-empty subset of [${TRANSPORTS.join(', ')}]`
    );
  }
  for (const field of ['tlsCertificatePinning', 'localProvisioning'] as const) {
    if (typeof caps[field] !== 'boolean') {
      throw new Error(`capabilities.json: ${driverId}.${field} must be a boolean`);
    }
  }
  if (caps.initializeMeta !== undefined && !isOneOf(caps.initializeMeta, INIT_META)) {
    throw new Error(
      `capabilities.json: ${driverId}.initializeMeta must be one of [${INIT_META.join(', ')}]`
    );
  }

  const app = caps.app;
  if (app === undefined || app === null) {
    return; // Absent app block = "goose-full" compat default.
  }
  if (typeof app !== 'object') {
    throw new Error(`capabilities.json: ${driverId}.app must be an object when present`);
  }
  const appCaps = app as Record<string, unknown>;
  const booleanFields = [
    'sessionList',
    'sessionResume',
    'sessionRename',
    'onboardingGuard',
    'providers',
    'recipes',
    'schedules',
    'mcpApps',
    'steer',
  ] as const;
  for (const field of booleanFields) {
    booleanOrUndefined(appCaps[field], `${driverId}.app.${field}`);
  }
  if (appCaps.cancel !== undefined && !isOneOf(appCaps.cancel, CANCELS)) {
    throw new Error(
      `capabilities.json: ${driverId}.app.cancel must be one of [${CANCELS.join(', ')}]`
    );
  }
  if (
    appCaps.reconnectPolicy !== undefined &&
    !isOneOf(appCaps.reconnectPolicy, RECONNECT_POLICIES)
  ) {
    throw new Error(
      `capabilities.json: ${driverId}.app.reconnectPolicy must be one of [${RECONNECT_POLICIES.join(', ')}]`
    );
  }
  if (
    appCaps.permissionSurface !== undefined &&
    !isOneOf(appCaps.permissionSurface, PERMISSION_SURFACES)
  ) {
    throw new Error(
      `capabilities.json: ${driverId}.app.permissionSurface must be one of [${PERMISSION_SURFACES.join(', ')}]`
    );
  }
  if (
    appCaps.modelLabel !== undefined &&
    appCaps.modelLabel !== null &&
    typeof appCaps.modelLabel !== 'string'
  ) {
    throw new Error(`capabilities.json: ${driverId}.app.modelLabel must be a string or null`);
  }
  if (appCaps.notes !== undefined) {
    if (!Array.isArray(appCaps.notes) || !appCaps.notes.every((n) => typeof n === 'string')) {
      throw new Error(`capabilities.json: ${driverId}.app.notes must be a string[]`);
    }
  }
}

export interface DriverCapabilitiesFile {
  [driverId: string]: DriverCapabilityEntry;
}

function readCapabilitiesFile(): DriverCapabilitiesFile {
  const raw = JSON.parse(
    readFileSync(path.join(__dirname, 'capabilities.json'), 'utf-8')
  ) as Record<string, unknown>;

  const entries = new Map<string, DriverCapabilityEntry>();
  for (const [driverId, value] of Object.entries(raw)) {
    const entry = value as { displayName?: unknown; capabilities?: unknown };
    if (typeof entry.displayName !== 'string' || entry.displayName.length === 0) {
      throw new Error(`capabilities.json: ${driverId}.displayName must be a non-empty string`);
    }
    validateCapabilities(driverId, entry.capabilities);
    entries.set(driverId, {
      displayName: entry.displayName,
      capabilities: entry.capabilities as DriverCapabilities,
    });
  }
  return Object.fromEntries(entries);
}

/** Loaded + validated once at module init; malformed JSON fails tests loudly. */
export const DRIVER_CAPABILITY_ENTRIES: Readonly<Record<string, DriverCapabilityEntry>> =
  readCapabilitiesFile();

export function driverCapabilityEntry(driverId: string): DriverCapabilityEntry {
  const entry = DRIVER_CAPABILITY_ENTRIES[driverId];
  if (!entry) {
    throw new Error(`no capability declaration for driver: ${driverId}`);
  }
  return entry;
}

/**
 * Resolves the app-layer capability flags with the documented compat default:
 * an absent field (or whole `app` block) means goose-full. Consumers should
 * call this instead of poking `capabilities.app` directly.
 */
export function appCapabilities(caps: DriverCapabilities): Required<
  Pick<
    DriverAppCapabilities,
    | 'sessionList'
    | 'sessionResume'
    | 'sessionRename'
    | 'onboardingGuard'
    | 'providers'
    | 'recipes'
    | 'schedules'
    | 'mcpApps'
    | 'steer'
    | 'cancel'
    | 'reconnectPolicy'
    | 'permissionSurface'
    | 'notes'
  >
> & { modelLabel: string | null } {
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
