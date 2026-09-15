#!/usr/bin/env node
/**
 * FLEET-HUB-001 M1 — fleetd entry.
 *
 *   tsx fleetd/src/main.ts [--port <n>] [--settings <path>] [--auth-file <path>]
 *
 * Writes {port, token} to the discovery file (default
 * ~/.local/state/fleet/fleetd.json) so consumers (bridge, future faces) can
 * attach with zero configuration. Logs to stderr.
 */
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFleetd } from './server';

function defaultSettingsPath(): string {
  return path.join(os.homedir(), '.config', 'Fleet', 'settings.json');
}

function defaultAuthFile(): string {
  return path.join(os.homedir(), '.local', 'state', 'fleet', 'fleetd.json');
}

function parseOptions(argv: string[]): Record<string, string> {
  const options: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    options[argv[i]!.replace(/^--/, '')] = argv[i + 1]!;
  }
  return options;
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const settingsPath = options.settings ?? defaultSettingsPath();
  const authFile = options['auth-file'] ?? defaultAuthFile();

  if (!existsSync(settingsPath)) {
    console.error(`[fleetd] settings not found: ${settingsPath}`);
    process.exit(1);
  }

  const fleetd = await createFleetd({
    settingsPath,
    port: options.port ? Number(options.port) : undefined,
  });

  mkdirSync(path.dirname(authFile), { recursive: true });
  writeFileSync(
    authFile,
    JSON.stringify({ port: fleetd.port, token: fleetd.token, pid: process.pid }, null, 2),
    'utf-8'
  );
  console.error(`[fleetd] listening on 127.0.0.1:${fleetd.port} (auth: ${authFile})`);

  const shutdown = () => {
    try {
      unlinkSync(authFile);
    } catch {
      // already gone
    }
    fleetd.close().then(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

void main();
