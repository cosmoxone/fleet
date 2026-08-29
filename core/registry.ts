import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { validateFleetNode, type FleetNode } from './node';

/** Structural slice of the shell settings file the registry operates on. */
export interface FleetSettingsStore {
  externalBackends?: FleetNode[];
  [key: string]: unknown;
}

export type NewFleetNode = Omit<FleetNode, 'id'> & { id?: string };

export function listNodes(settings: FleetSettingsStore): FleetNode[] {
  return settings.externalBackends ?? [];
}

export function addNode(settings: FleetSettingsStore, node: NewFleetNode): FleetNode {
  const entry: FleetNode = { ...node, id: node.id ?? randomUUID() };
  const error = validateFleetNode(entry);
  if (error) {
    throw new Error(`invalid fleet node: ${error}`);
  }
  settings.externalBackends = [...listNodes(settings), entry];
  return entry;
}

/** @returns false when the id is unknown. */
export function renameNode(settings: FleetSettingsStore, id: string, name: string): boolean {
  const node = listNodes(settings).find((n) => n.id === id);
  if (!node) return false;
  node.name = name;
  return true;
}

/** @returns false when the id is unknown. */
export function updateNodeSecret(settings: FleetSettingsStore, id: string, secret: string): boolean {
  const node = listNodes(settings).find((n) => n.id === id);
  if (!node) return false;
  node.secret = secret;
  return true;
}

/** @returns false when the id is unknown. */
export function removeNode(settings: FleetSettingsStore, id: string): boolean {
  const nodes = listNodes(settings);
  const next = nodes.filter((n) => n.id !== id);
  if (next.length === nodes.length) return false;
  settings.externalBackends = next;
  return true;
}

export function loadFleetSettings(file: string): FleetSettingsStore {
  return JSON.parse(readFileSync(file, 'utf8')) as FleetSettingsStore;
}

export function saveFleetSettings(file: string, settings: FleetSettingsStore): void {
  writeFileSync(file, JSON.stringify(settings, null, 2));
}
