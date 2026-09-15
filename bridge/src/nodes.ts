
import { loadFleetSettings } from '../../core/registry';
import { effectiveDriverId, fleetNodeSlug, type FleetNode } from '../../core/node';

/** Node view exposed to MCP tool consumers (slug is the machine key). */
export interface BridgeNodeInfo {
  id: string;
  slug: string;
  name: string;
  driver: string;
  url: string;
}

/** Loads the shared fleet registry (same settings.json the desktop shell reads). */
export function loadBridgeNodes(settingsPath: string): BridgeNodeInfo[] {
  const settings = loadFleetSettings(settingsPath);
  return (settings.externalBackends ?? []).map((node) => ({
    id: node.id,
    slug: fleetNodeSlug(node),
    name: node.name,
    driver: effectiveDriverId(node),
    url: node.url,
  }));
}

/** Resolves a node by slug first, then by id (both are stable keys). */
export function findBridgeNode(settingsPath: string, slugOrId: string): FleetNode | undefined {
  const settings = loadFleetSettings(settingsPath);
  const nodes = settings.externalBackends ?? [];
  return (
    nodes.find((n) => fleetNodeSlug(n) === slugOrId) ??
    nodes.find((n) => n.id === slugOrId) ??
    undefined
  );
}
