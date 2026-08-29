#!/usr/bin/env node
// fleet node-cli — manage `externalBackends` in the shell settings.json
// without the UI. Works against the Fleet app or a dev instance.
//
// Usage:
//   pnpm node-cli -- list [--file <settings.json>]
//   pnpm node-cli -- add --name dev-box --url https://192.168.1.11:3284 --secret S \
//        [--fingerprint AA:BB:...] [--workdir /home/goose/ws] [--driver goose]
//   pnpm node-cli -- rename --id <nodeId> --name <newName>
//   pnpm node-cli -- secret --id <nodeId> --secret S2     # rotate a node secret
//   pnpm node-cli -- remove --id <nodeId>
//
// settings.json location (default): Windows %APPDATA%/Fleet/settings.json,
// macOS ~/Library/Application Support/Fleet/settings.json,
// Linux ~/.config/Fleet/settings.json.
import { existsSync } from 'node:fs';
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

function parseArgs(argv: string[]): { command: string; options: Record<string, string> } {
  const [command, ...rest] = argv;
  const options: Record<string, string> = {};
  for (let i = 0; i < rest.length; i += 2) {
    options[rest[i]!.replace(/^--/, '')] = rest[i + 1]!;
  }
  return { command: command ?? '', options };
}

// Tolerate the leading "--" some runners (pnpm) forward to the script.
const argv = process.argv.slice(2);
const { command, options } = parseArgs(argv[0] === '--' ? argv.slice(1) : argv);
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
      });
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    }
    saveFleetSettings(file, settings);
    console.log(`added '${entry.name}' (${entry.id}) -> ${file}`);
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
