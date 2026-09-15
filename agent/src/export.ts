import path from 'node:path';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadFleetNodes } from '../../bridge/src/nodes';
import { fleetNodeSlug } from '../../core/node';
import { describeRouting } from './routing';

/**
 * FLEET-HUB-001 M2-alt — `fleet acpx-export`: emit the fleet as acpx-format
 * agent entries (JSON5-compatible JSON). One passthrough entry per node plus
 * a `fleet-hub` entry whose description teaches the @slug routing convention
 * (Layer 3 discovery channel for LLM orchestrators).
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const MAIN_TS = path.join(REPO_ROOT, 'agent', 'src', 'main.ts');
const TSX_BIN = path.join(REPO_ROOT, 'node_modules', '.bin', 'tsx');

export interface AcpxAgentCommand {
  command: string;
  args: string[];
  env?: Record<string, string>;
  cwd?: string;
  description?: string;
}

export interface AcpxExport {
  [key: string]: AcpxAgentCommand;
}

export function buildAcpxExport(
  nodes: { name: string; driver: string; url: string } & { slug?: string; id: string }[],
  overrides: { tsxBin?: string; mainTs?: string } = {}
): AcpxExport {
  const tsxBin = overrides.tsxBin ?? TSX_BIN;
  const mainTs = overrides.mainTs ?? MAIN_TS;
  const export_: AcpxExport = {};
  const slugs: string[] = [];
  for (const node of nodes) {
    const slug = node.slug ?? fleetNodeSlug(node as { slug?: string; name: string });
    slugs.push(slug);
    export_[`fleet-${slug}`] = {
      command: tsxBin,
      args: [mainTs, 'agent', '--node', slug],
      description: `Fleet node passthrough: ${node.name} (driver ${node.driver}, ${node.url})`,
    };
  }
  if (slugs.length > 0) {
    export_['fleet-hub'] = {
      command: tsxBin,
      args: [mainTs, 'agent'],
      description: `Fleet hub (whole registry in one agent) — ${describeRouting(slugs)}`,
    };
  }
  return export_;
}

export function exportToFileOrStdout(settingsPath: string, outFile?: string): AcpxExport {
  const nodes = loadFleetNodes(settingsPath).map((n) => ({
    id: n.id,
    name: n.name,
    driver: n.driver ?? 'goose',
    url: n.url,
    slug: fleetNodeSlug(n),
  }));
  const payload = buildAcpxExport(nodes);
  const text = JSON.stringify(payload, null, 2);
  if (outFile) {
    writeFileSync(outFile, text, 'utf-8');
  } else {
    process.stdout.write(text + '\n');
  }
  return payload;
}
