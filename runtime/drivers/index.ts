import type { AcpDriver } from '../../core/driver';
import { gooseDriver } from './goose/driver';
import { dshDriver } from './dsh/driver';
import { stdioDriver } from './stdio/driver';
import { DEFAULT_DRIVER_ID, effectiveDriverId, type FleetNode } from '../../core/node';
import { driverCapabilityEntry } from './capabilities';

/**
 * Driver registry (core-facing side). The app consumes a generated mirror of
 * the capability declarations: runtime/drivers/capabilities.json →
 * scripts/gen-driver-capabilities.mjs → app/src/utils/generated/… (CI checks
 * drift). Add a driver = register here + declare in capabilities.json +
 * regenerate; nothing stays hand-synced.
 */
export const DRIVERS: ReadonlyMap<string, AcpDriver> = new Map([
  [gooseDriver.id, gooseDriver],
  [dshDriver.id, dshDriver],
  [stdioDriver.id, stdioDriver],
]);

export function resolveDriver(id: string | undefined): AcpDriver {
  const effective = id ?? DEFAULT_DRIVER_ID;
  const driver = DRIVERS.get(effective);
  if (!driver) {
    throw new Error(`unknown fleet driver: ${effective}`);
  }
  return driver;
}

export function resolveDriverForNode(node: Pick<FleetNode, 'driver'>): AcpDriver {
  return resolveDriver(effectiveDriverId(node));
}

export function listDriverOptions(): { id: string; displayName: string }[] {
  // Display names come from capabilities.json (single source); the map order
  // (registration order) stays authoritative for menu ordering.
  return [...DRIVERS.values()].map((driver) => ({
    id: driver.id,
    displayName: driverCapabilityEntry(driver.id).displayName,
  }));
}
