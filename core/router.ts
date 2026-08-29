import type { FleetNode } from './node';

/** Connection parameters for a fleet node, as consumed by an ACP driver. */
export interface BackendConnection {
  source: 'settings';
  url: string;
  secret: string;
  certFingerprint?: string;
  workingDir?: string;
  fleetNodeId: string;
  fleetNodeName: string;
}

export function resolveNodeBackend(
  settings: { externalBackends?: FleetNode[] },
  backendId: string
): BackendConnection | null {
  const node = settings.externalBackends?.find((n) => n.id === backendId);
  if (!node) {
    return null;
  }
  return {
    source: 'settings',
    url: node.url,
    secret: node.secret,
    certFingerprint: node.certFingerprint,
    workingDir: node.workingDir,
    fleetNodeId: node.id,
    fleetNodeName: node.name,
  };
}

/** Every node as an enabled backend config (CSP allow-list face for the renderer). */
export function allBackendConfigs(
  settings: { externalBackends?: FleetNode[] }
): Array<{
  enabled: true;
  url: string;
  secret: string;
  certFingerprint?: string;
  workingDir?: string;
}> {
  return (settings.externalBackends ?? []).map((node) => ({
    enabled: true as const,
    url: node.url,
    secret: node.secret,
    certFingerprint: node.certFingerprint,
    workingDir: node.workingDir,
  }));
}
