#!/usr/bin/env node
/**
 * FLEET-HUB-001 M2-alt — `fleet` CLI (face ⑥).
 *
 *   tsx agent/src/main.ts agent [--node <slug>] [--settings <path>]
 *       Run fleet as a stdio ACP agent (passthrough or hub mode).
 *   tsx agent/src/main.ts acpx-export [--settings <path>] [--out <file>]
 *       Emit acpx-format agent entries for the fleet registry.
 *
 * Logs go to stderr — stdout is the ACP channel in agent mode.
 */
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStdioAgentTransport } from './stdio';
import { createFleetAgentApp } from './agentFace';
import { exportToFileOrStdout } from './export';

function defaultSettingsPath(): string {
  return path.join(os.homedir(), '.config', 'Fleet', 'settings.json');
}

function parseOptions(argv: string[]): Record<string, string> {
  const options: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    options[argv[i]!.replace(/^--/, '')] = argv[i + 1]!;
  }
  return options;
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const options = parseOptions(rest);
  const settingsPath = options.settings ?? defaultSettingsPath();

  if (command === 'acpx-export') {
    exportToFileOrStdout(settingsPath, options.out);
    return;
  }

  if (command !== 'agent') {
    console.error('usage: fleet agent [--node <slug>] [--settings <path>] | fleet acpx-export [--out <file>]');
    process.exit(1);
  }

  if (!existsSync(settingsPath)) {
    console.error(`[fleet-agent] settings not found: ${settingsPath}`);
    process.exit(1);
  }

  const app = createFleetAgentApp({ settingsPath, node: options.node });
  await app.connect(createStdioAgentTransport());
  console.error(
    `[fleet-agent] ${options.node ? `passthrough node=${options.node}` : 'hub mode'} — serving from ${settingsPath}`
  );
}

void main();
