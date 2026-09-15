import type { MenuItemConstructorOptions } from 'electron';
import type { ExternalBackendConfig, FleetNodeConfig, Settings } from './settings';
import { normalizeAcpHttpBaseUrl } from '../acp/url';
import {
  DRIVER_CAPABILITY_ENTRIES,
  type FleetDriverCapabilities,
} from './generated/driverCapabilities';

export const FLEET_MENU_LABEL = 'New Chat on Node…';
export const FLEET_MENU_EMPTY_HINT = 'Add nodes in Settings → Sharing → Fleet Nodes';

export interface ExternalBackend {
  source: 'env' | 'settings';
  url: string;
  secret: string;
  certFingerprint?: string;
  workingDir?: string;
  /** Backend driver serving this URL ('goose' | 'dsh'). Omitted = goose. */
  driver?: string;
  /** Set when this backend comes from a fleet node entry (per-window binding). */
  fleetNodeId?: string;
  fleetNodeName?: string;
}

/**
 * Driver options for the fleet node settings UI. Generated from the single
 * source (runtime/drivers/capabilities.json) via
 * scripts/gen-driver-capabilities.mjs — the hand-written mirror is retired
 * (FLEET-CATALOG-001 S2); CI verifies the artifact stays in sync.
 */
export const FLEET_DRIVER_OPTIONS = Object.entries(DRIVER_CAPABILITY_ENTRIES).map(([id, entry]) => ({
  id,
  displayName: entry.displayName,
}));

export type FleetDriverId = keyof typeof DRIVER_CAPABILITY_ENTRIES;

/** Resolves a driver's declared capabilities (typed mirror of core schema). */
export function fleetDriverCapabilities(driver: string | undefined): FleetDriverCapabilities {
  return (
    DRIVER_CAPABILITY_ENTRIES[driver as FleetDriverId] ??
    DRIVER_CAPABILITY_ENTRIES.goose
  ).capabilities;
}

/** Normalizes a node's driver field; unknown/missing values fall back to goose. */
export function effectiveFleetDriver(driver: string | undefined): FleetDriverId {
  return FLEET_DRIVER_OPTIONS.some((option) => option.id === driver) ? (driver as FleetDriverId) : 'goose';
}

export function getFleetNodeBackend(settings: Settings, backendId: string): ExternalBackend | null {
  const node = settings.externalBackends.find((n) => n.id === backendId);
  if (!node) {
    return null;
  }
  return {
    source: 'settings',
    url: node.url,
    secret: node.secret,
    certFingerprint: node.certFingerprint,
    workingDir: node.workingDir,
    driver: effectiveFleetDriver(node.driver),
    fleetNodeId: node.id,
    fleetNodeName: node.name,
  };
}

export function getFleetCspBackends(settings: Settings): ExternalBackendConfig[] {
  return settings.externalBackends.map((node) => ({
    enabled: true,
    url: node.url,
    secret: node.secret,
    certFingerprint: node.certFingerprint,
    workingDir: node.workingDir,
  }));
}

export function buildFleetNodeSubmenu(
  nodes: FleetNodeConfig[],
  onOpen: (node: FleetNodeConfig) => void
): MenuItemConstructorOptions {
  if (nodes.length === 0) {
    return {
      label: FLEET_MENU_LABEL,
      enabled: false,
      submenu: [{ label: FLEET_MENU_EMPTY_HINT, enabled: false }],
    };
  }
  return {
    label: FLEET_MENU_LABEL,
    submenu: nodes.map((node) => ({
      label: node.name || node.url,
      click: () => onOpen(node),
    })),
  };
}

export type FleetNodeValidationError =
  | 'nameRequired'
  | 'urlProtocol'
  | 'urlBase'
  | 'urlFormat'
  | 'fingerprintRequiresHttps';

export function validateFleetNode(node: FleetNodeConfig): FleetNodeValidationError | null {
  if (!node.name.trim()) {
    return 'nameRequired';
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
