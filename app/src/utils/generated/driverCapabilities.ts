// AUTO-GENERATED from runtime/drivers/capabilities.json — DO NOT EDIT.
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
  /** false = desktop shell cannot drive this driver yet (hidden from dropdown). */
  desktopShell?: boolean;
  app?: FleetDriverAppCapabilities;
}

export interface FleetDriverCapabilityEntry {
  displayName: string;
  capabilities: FleetDriverCapabilities;
}

/** Driver id -> declaration (registered drivers only). */
export const DRIVER_CAPABILITY_ENTRIES = {
  "goose": {
    "displayName": "goose (goose serve, ACP over WebSocket)",
    "capabilities": {
      "protocol": "acp",
      "transports": [
        "http-websocket"
      ],
      "tlsCertificatePinning": true,
      "localProvisioning": true,
      "initializeMeta": "goose",
      "app": {
        "sessionList": true,
        "sessionResume": true,
        "sessionRename": true,
        "onboardingGuard": true,
        "providers": true,
        "recipes": true,
        "schedules": true,
        "mcpApps": true,
        "steer": true,
        "cancel": "request",
        "reconnectPolicy": "resume",
        "permissionSurface": "acp-standard",
        "modelLabel": null,
        "notes": []
      }
    }
  },
  "dsh": {
    "displayName": "DeepSeek Harness (dsh-acp-demo via acp-ws bridge)",
    "capabilities": {
      "protocol": "acp",
      "transports": [
        "http-websocket"
      ],
      "tlsCertificatePinning": true,
      "localProvisioning": false,
      "initializeMeta": "standard",
      "app": {
        "sessionList": false,
        "sessionResume": false,
        "sessionRename": false,
        "onboardingGuard": false,
        "providers": false,
        "recipes": false,
        "schedules": false,
        "mcpApps": false,
        "steer": false,
        "cancel": "notify-noop",
        "reconnectPolicy": "fresh-session",
        "permissionSurface": "silent-policy",
        "modelLabel": "remote (node-configured)",
        "notes": [
          "fleetNodes.driver.dsh.noteSessionHistory",
          "fleetNodes.driver.dsh.noteModelRemote",
          "fleetNodes.driver.dsh.noteCancelSilent"
        ]
      }
    }
  },
  "stdio": {
    "displayName": "Local stdio ACP agent (spawn)",
    "capabilities": {
      "protocol": "acp",
      "transports": [
        "stdio"
      ],
      "tlsCertificatePinning": false,
      "localProvisioning": true,
      "initializeMeta": "standard",
      "app": {
        "sessionList": false,
        "sessionResume": false,
        "sessionRename": false,
        "onboardingGuard": false,
        "providers": false,
        "recipes": false,
        "schedules": false,
        "mcpApps": false,
        "steer": false,
        "cancel": "request",
        "reconnectPolicy": "fresh-session",
        "permissionSurface": "acp-standard",
        "modelLabel": "local (spawned)",
        "notes": [
          "fleetNodes.driver.stdio.noteSpawnedProcess"
        ]
      },
      "desktopShell": true
    }
  }
} as const;

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
