import { useEffect, useState } from 'react';
import { getAcpDriver } from '../acp/acpConnection';
import { fleetDriverCapabilities } from '../utils/fleet';
import { fleetAppCapabilities } from '../utils/generated/driverCapabilities';

export type FleetAppCapabilities = ReturnType<typeof fleetAppCapabilities>;

/**
 * Driver capability flags for THIS window's backend, from the F-2 catalog
 * (single source: runtime/drivers/capabilities.json via generated mirror).
 * Resolves once per window (driver is constant per connection); until the
 * driver resolves, the goose-full compat default is returned so goose
 * windows never flicker. Non-goose windows flip to their declared surface
 * before first paint of gated entries in practice (driver resolves with the
 * ACP connection), and the runtime -32601 softening stays as the second
 * line of defense either way.
 */

let cached: FleetAppCapabilities | null = null;
let pending: Promise<FleetAppCapabilities> | null = null;

function resolveOnce(): Promise<FleetAppCapabilities> {
  if (!pending) {
    pending = getAcpDriver()
      .then((driver) => {
        cached = fleetAppCapabilities(fleetDriverCapabilities(driver));
        return cached;
      })
      .catch(() => {
        // Catalog unavailable — goose-full default (already in state).
        pending = null;
        return fleetAppCapabilities(fleetDriverCapabilities(undefined));
      });
  }
  return pending;
}

/** @internal Test-only: clears the per-window resolution cache. */
export function __resetFleetAppCapabilitiesForTest(): void {
  cached = null;
  pending = null;
}

export function useFleetAppCapabilities(): FleetAppCapabilities {
  const [caps, setCaps] = useState<FleetAppCapabilities>(
    () => cached ?? fleetAppCapabilities(fleetDriverCapabilities(undefined))
  );

  useEffect(() => {
    if (cached) {
      setCaps(cached);
      return;
    }
    let alive = true;
    void resolveOnce().then((resolved) => {
      if (alive) {
        setCaps(resolved);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  return caps;
}
