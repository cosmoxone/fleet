#!/usr/bin/env node
/**
 * FLEET-ORCH-001 M0 — ACP→MCP bridge (standalone pilot).
 *
 * Exposes the fleet registry to any MCP host (goose CLI first) over stdio:
 *   tools: list_nodes | node_health | dispatch
 * Config: --settings <path> (default: the desktop shell's settings.json).
 *
 * Logs go to stderr — stdout is the MCP protocol channel.
 *
 * Usage (goose extension, ~/.config/goose/config.yaml):
 *   extensions:
 *     fleet-bridge:
 *       command: <abs-ts-node-runner>
 *       args: [<repo>/bridge/src/main.ts]
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { loadBridgeNodes, findBridgeNode } from './nodes';
import { dispatchToNode } from './dispatch';
import { resolveDriverForNode } from '../../runtime/drivers';

function defaultSettingsPath(): string {
  return path.join(os.homedir(), '.config', 'Fleet', 'settings.json');
}

function parseArgs(argv: string[]) {
  const options: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    options[argv[i]!.replace(/^--/, '')] = argv[i + 1]!;
  }
  return options;
}

export function createBridgeServer(settingsPath: string): Server {
  const server = new Server({ name: 'fleet-bridge', version: '0.1.0' }, {
    capabilities: { tools: {} },
  });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'list_nodes',
        description:
          'List the registered fleet nodes (id/slug/name/driver/url). Use the slug as the node key.',
        inputSchema: { type: 'object' as const, properties: {}, additionalProperties: false },
      },
      {
        name: 'node_health',
        description: 'Run a health check against one fleet node (status probe).',
        inputSchema: {
          type: 'object' as const,
          properties: { node: { type: 'string', description: 'node slug or id' } },
          required: ['node'],
          additionalProperties: false,
        },
      },
      {
        name: 'dispatch',
        description:
          'Send one prompt to a fleet node agent and return its aggregated reply (single turn; permission requests are denied by default).',
        inputSchema: {
          type: 'object' as const,
          properties: {
            node: { type: 'string', description: 'node slug or id' },
            prompt: { type: 'string' },
            timeoutMs: { type: 'number', description: 'default 120000' },
          },
          required: ['node', 'prompt'],
          additionalProperties: false,
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = request.params.name;
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;
    try {
      if (tool === 'list_nodes') {
        const nodes = loadBridgeNodes(settingsPath);
        return { content: [{ type: 'text', text: JSON.stringify(nodes, null, 2) }] };
      }
      const nodeKey = String(args.node ?? '');
      const node = findBridgeNode(settingsPath, nodeKey);
      if (!node) {
        return {
          content: [{ type: 'text', text: `unknown fleet node: ${nodeKey}` }],
          isError: true,
        };
      }
      if (tool === 'node_health') {
        const report = await resolveDriverForNode(node).healthCheck(node);
        return { content: [{ type: 'text', text: JSON.stringify(report) }] };
      }
      if (tool === 'dispatch') {
        const result = await dispatchToNode(
          node,
          String(args.prompt ?? ''),
          typeof args.timeoutMs === 'number' ? args.timeoutMs : 120_000
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  node: nodeKey,
                  sessionId: result.sessionId,
                  stopReason: result.stopReason,
                  updateCount: result.updateCount,
                  permissionRequests: result.permissionRequests,
                  reply: result.text,
                },
                null,
                2
              ),
            },
          ],
        };
      }
      return { content: [{ type: 'text', text: `unknown tool: ${tool}` }], isError: true };
    } catch (error) {
      console.error(`[fleet-bridge] ${tool} failed:`, error);
      return {
        content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
        isError: true,
      };
    }
  });

  return server;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const settingsPath = options.settings ?? defaultSettingsPath();
  if (!fs.existsSync(settingsPath)) {
    console.error(`[fleet-bridge] settings not found: ${settingsPath}`);
    process.exit(1);
  }
  const server = createBridgeServer(settingsPath);
  await server.connect(new StdioServerTransport());
  console.error(`[fleet-bridge] serving fleet from ${settingsPath}`);
}

// Entry only when run directly (tests import createBridgeServer instead).
if (process.argv[1]?.endsWith('main.ts')) {
  void main();
}
