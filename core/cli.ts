#!/usr/bin/env node
// fleet node-cli — manage `externalBackends` in the shell settings.json
// without the UI. Works against the Fleet app or a dev instance.
//
// Usage:
//   pnpm node-cli -- list [--file <settings.json>]
//   pnpm node-cli -- add --name dev-box --url https://192.168.1.11:3284 --secret S \
//        [--fingerprint AA:BB:...] [--workdir /home/goose/ws] [--driver goose] [--slug dev-box]
//   pnpm node-cli -- rename --id <nodeId> --name <newName>
//   pnpm node-cli -- secret --id <nodeId> --secret S2     # rotate a node secret
//   pnpm node-cli -- remove --id <nodeId>
//   pnpm node-cli -- add --name local-claude --command npx --args-json '["-y","@agentclientprotocol/claude-acp"]' --driver stdio
//   pnpm node-cli -- import-acpx <registry.json> [--file <settings.json>]
//
// settings.json location (default): Windows %APPDATA%/Fleet/settings.json,
// macOS ~/Library/Application Support/Fleet/settings.json,
// Linux ~/.config/Fleet/settings.json.
import { existsSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import {
  addNode,
  loadFleetSettings,
  removeNode,
  renameNode,
  saveFleetSettings,
  updateNodeSecret,
  type FleetSettingsStore,
} from './registry';

function defaultSettingsFile(): string {
  const home = homedir();
  if (process.platform === 'win32') {
    return path.join(
      process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming'),
      'Fleet',
      'settings.json'
    );
  }
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'Fleet', 'settings.json');
  }
  return path.join(home, '.config', 'Fleet', 'settings.json');
}

function parseArgs(argv: string[]): {
  command: string;
  options: Record<string, string>;
  positional?: string;
} {
  const [command, ...rest] = argv;
  const options: Record<string, string> = {};
  let positional: string | undefined;
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i]!;
    if (token.startsWith('--')) {
      // Flag (with its value, when present and not itself a flag).
      const next = rest[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        options[token.replace(/^--/, '')] = next;
        i++;
      } else {
        options[token.replace(/^--/, '')] = 'true';
      }
      continue;
    }
    if (positional === undefined) {
      positional = token;
    }
  }
  return { command: command ?? '', options, positional };
}

// Tolerate the leading "--" some runners (pnpm) forward to the script.
const argv = process.argv.slice(2);
const parsed = parseArgs(argv[0] === '--' ? argv.slice(1) : argv);
const { command, options } = parsed;
const file = options.file ?? defaultSettingsFile();

let settings: FleetSettingsStore = {};
if (existsSync(file)) {
  settings = loadFleetSettings(file);
} else if (command !== 'add') {
  console.error(`Cannot read settings file: ${file}`);
  process.exit(1);
}

switch (command) {
  case 'list': {
    const nodes = settings.externalBackends ?? [];
    if (nodes.length === 0) {
      console.log('(no fleet nodes)');
      break;
    }
    for (const node of nodes) {
      console.log(
        `${node.id}  ${node.name}  ${node.url}${node.workingDir ? `  cwd=${node.workingDir}` : ''}`
      );
    }
    break;
  }

  case 'add': {
    if (!options.name || !options.url || !options.secret) {
      console.error('add requires --name --url --secret');
      process.exit(1);
    }
    let entry;
    try {
      entry = addNode(settings, {
        name: options.name,
        url: options.url,
        secret: options.secret,
        ...(options.id ? { id: options.id } : {}),
        ...(options.fingerprint ? { certFingerprint: options.fingerprint } : {}),
        ...(options.workdir ? { workingDir: options.workdir } : {}),
        ...(options.driver ? { driver: options.driver } : {}),
        ...(options.slug ? { slug: options.slug } : {}),
        ...(options.command ? { command: options.command } : {}),
        ...(options.argsJson ? { args: JSON.parse(options.argsJson) as string[] } : {}),
        ...(options.envJson ? { env: JSON.parse(options.envJson) as Record<string, string> } : {}),
      });
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    }
    saveFleetSettings(file, settings);
    console.log(`added '${entry.name}' (${entry.id}, slug=${entry.slug}) -> ${file}`);
    break;
  }

  case 'import-acpx': {
    const source = parsed.positional;
    if (!source) {
      console.error('import-acpx requires a registry file path');
      process.exit(1);
    }
    try {
      const raw = JSON.parse(readFileSync(source, 'utf-8')) as Record<
        string,
        { command?: string; args?: string[]; env?: Record<string, string> }
      >;
      let added = 0;
      for (const [key, entry] of Object.entries(raw)) {
        if (!entry.command) {
          continue; // non-agent keys / comment fields are skipped
        }
        try {
          addNode(settings, {
            name: key,
            url: '',
            secret: '',
            driver: 'stdio',
            command: entry.command,
            args: entry.args,
            env: entry.env,
          });
          added += 1;
        } catch (error) {
          console.error(`skip ${key}: ${error instanceof Error ? error.message : error}`);
        }
      }
      saveFleetSettings(file, settings);
      console.log(`imported ${added} agent(s) -> ${file}`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    }
    break;
  }
  case 'rename': {
    if (!renameNode(settings, options.id!, options.name!)) {
      console.error(`node not found: ${options.id}`);
      process.exit(1);
    }
    saveFleetSettings(file, settings);
    console.log(`renamed ${options.id} -> '${options.name}'`);
    break;
  }

  case 'secret': {
    if (!updateNodeSecret(settings, options.id!, options.secret!)) {
      console.error(`node not found: ${options.id}`);
      process.exit(1);
    }
    saveFleetSettings(file, settings);
    console.log(`updated secret for ${options.id}`);
    break;
  }

  case 'remove': {
    if (!removeNode(settings, options.id!)) {
      console.error(`node not found: ${options.id}`);
      process.exit(1);
    }
    saveFleetSettings(file, settings);
    console.log(`removed ${options.id}`);
    break;
  }

  default:
    console.error('commands: list | add | rename | secret | remove   (see header for flags)');
    process.exit(1);
}
