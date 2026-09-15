import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { TurnResult } from './dispatch';
import type { FleetNode } from '../../core/node';
import { dispatchToNode } from './dispatch';

/**
 * FLEET-HUB-001 M1 — bridge attached mode.
 *
 * Discovery (zero config): FLEETD_URL + FLEETD_TOKEN env override the
 * discovery file (~/.local/state/fleet/fleetd.json). When fleetd is up, the
 * dispatch tool proxies POST /dispatch (shared kernel); when it is down or
 * unreachable, the bridge silently stays standalone (M0 behavior) — the
 * failure mode of the hub is "no hub", never "no bridge".
 */

export interface FleetdTarget {
  url: string; // http://127.0.0.1:<port>
  token: string;
}

export interface DispatchThrough {
  via: 'fleetd' | 'standalone';
}

export function defaultDiscoveryFile(): string {
  return path.join(os.homedir(), '.local', 'state', 'fleet', 'fleetd.json');
}

export function resolveFleetd(discoveryFile: string = defaultDiscoveryFile()): FleetdTarget | null {
  if (process.env.FLEETD_URL && process.env.FLEETD_TOKEN) {
    return { url: process.env.FLEETD_URL, token: process.env.FLEETD_TOKEN };
  }
  try {
    if (existsSync(discoveryFile)) {
      const info = JSON.parse(readFileSync(discoveryFile, 'utf-8')) as {
        port?: number;
        token?: string;
      };
      if (info.port && info.token) {
        return { url: `http://127.0.0.1:${info.port}`, token: info.token };
      }
    }
  } catch {
    // Malformed discovery file — ignore, stay standalone.
  }
  return null;
}

async function fleetdDispatch(
  target: FleetdTarget,
  args: { node: string; prompt: string; timeoutMs: number }
): Promise<TurnResult> {
  const response = await fetch(`${target.url}/dispatch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-secret-key': target.token },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(args.timeoutMs + 10_000),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`fleetd dispatch failed (${response.status}): ${text.slice(0, 200)}`);
  }
  return (await response.json()) as TurnResult;
}

/**
 * Dispatch with fleetd attachment: tries the hub first (when discovered) and
 * falls back to the standalone path on any hub failure, reporting which path
 * served the turn.
 */
export async function dispatchWithFallback(
  node: FleetNode,
  args: { slug: string; prompt: string; timeoutMs: number },
  discoveryFile?: string
): Promise<TurnResult & DispatchThrough> {
  const target = resolveFleetd(discoveryFile);
  if (target) {
    try {
      const result = await fleetdDispatch(target, {
        node: args.slug,
        prompt: args.prompt,
        timeoutMs: args.timeoutMs,
      });
      return { ...result, via: 'fleetd' };
    } catch (error) {
      console.error('[fleet-bridge] fleetd unreachable, falling back to standalone:', error);
    }
  }
  const result = await dispatchToNode(node, args.prompt, args.timeoutMs);
  return { ...result, via: 'standalone' };
}
