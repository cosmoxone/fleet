#!/usr/bin/env node
// fetch-goose — pull a stock goose release binary, verify SHA256 against
// runtime/versions.json, and inject it into app/src/bin for packaging.
//
// Usage:
//   pnpm exec tsx runtime/drivers/goose/fetch-goose.ts --platform linux --arch x64
//   pnpm exec tsx runtime/drivers/goose/fetch-goose.ts --platform win32 --arch x64
//   pnpm exec tsx runtime/drivers/goose/fetch-goose.ts --platform linux --arch x64 \
//        --from-file /path/to/goose        # offline/dev injection, hash check skipped
//
// Platform/arch default to the host. Version defaults to versions.json
// drivers.goose.packagedVersion; hash pinning is enforced for downloads.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { get } from 'node:https';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const VERSIONS = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, 'runtime', 'versions.json'), 'utf8')
) as {
  drivers: {
    goose: {
      packagedVersion: string;
      assets: Record<string, { name: string; sha256: string }>;
    };
  };
};

const ASSET_NAMES: Record<string, string> = {
  'win32-x64': 'goose-x86_64-pc-windows-msvc.zip',
  'darwin-arm64': 'goose-aarch64-apple-darwin.tar.gz',
  'darwin-x64': 'goose-x86_64-apple-darwin.tar.gz',
  'linux-x64': 'goose-x86_64-unknown-linux-gnu.tar.gz',
  'linux-arm64': 'goose-aarch64-unknown-linux-gnu.tar.gz',
};

function parseArgs(argv: string[]): Record<string, string> {
  const options: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    options[argv[i]!.replace(/^--/, '')] = argv[i + 1]!;
  }
  return options;
}

const hostPlatform = process.platform === 'win32' ? 'win32' : process.platform;
const hostArch = process.arch === 'x64' ? 'x64' : process.arch;
const options = parseArgs(process.argv.slice(2));
const fromFile = options['from-file'] ?? options.fromFile;
const target = `${options.platform ?? hostPlatform}-${options.arch ?? hostArch}`;
const version = options.version ?? VERSIONS.drivers.goose.packagedVersion;
const outDir = options.out
  ? path.resolve(options.out)
  : path.join(REPO_ROOT, 'app', 'src', 'bin');
const destName = target.startsWith('win32-') ? 'goose.exe' : 'goose';
const dest = path.join(outDir, destName);

const pinned = VERSIONS.drivers.goose.assets[target];
const expectedName = ASSET_NAMES[target];
if (!pinned || !expectedName) {
  console.error(`No goose asset configured for target: ${target}`);
  process.exit(1);
}
if (fromFile) {
  const src = path.resolve(fromFile);
  fs.mkdirSync(outDir, { recursive: true });
  fs.copyFileSync(src, dest);
  fs.chmodSync(dest, 0o755);
  console.log(`injected ${src} -> ${dest}`);
  console.log(`sha256: ${sha256(dest)}`);
  console.log('NOTE: --from-file skips the versions.json hash pin (dev/offline mode).');
  process.exit(0);
}

const url = `https://github.com/aaif-goose/goose/releases/download/v${version}/${pinned.name}`;
if (pinned.name !== expectedName) {
  console.error(
    `versions.json asset for ${target} is "${pinned.name}", expected "${expectedName}" — matrix drifted.`
  );
  process.exit(1);
}

function sha256(file: string): string {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function download(url_: string, destPath: string, redirectsLeft = 5): Promise<void> {
  return new Promise((resolve, reject) => {
    get(url_, (res) => {
      if (
        res.statusCode! >= 300 &&
        res.statusCode! < 400 &&
        res.headers.location &&
        redirectsLeft > 0
      ) {
        res.resume();
        download(res.headers.location, destPath, redirectsLeft - 1).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode} for ${url_}`));
        return;
      }
      const file = fs.createWriteStream(destPath);
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve()));
      file.on('error', reject);
    }).on('error', reject);
  });
}

function extract(archive: string, destDir: string): void {
  const isZip = archive.endsWith('.zip');
  const command = process.platform === 'win32' ? 'tar' : isZip ? 'unzip' : 'tar';
  const args =
    process.platform === 'win32'
      ? ['-xf', archive, '-C', destDir]
      : isZip
        ? ['-o', archive, '-d', destDir]
        : ['-xzf', archive, '-C', destDir];
  const result = spawnSync(command, args, { stdio: 'pipe' });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed: ${result.stderr}`);
  }
}

function findBinary(dir: string, name: string): string {
  const queue = [dir];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) queue.push(full);
      else if (entry.name === name) return full;
    }
  }
  throw new Error(`goose binary not found inside extracted archive (looked for ${name})`);
}

const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-fetch-goose-'));
const archivePath = path.join(cacheDir, pinned.name);

process.stdout.write(`downloading ${url} ...\n`);
let downloaded = false;
for (let attempt = 1; attempt <= 3 && !downloaded; attempt++) {
  try {
    await download(url, archivePath);
    downloaded = true;
  } catch (error) {
    console.error(`attempt ${attempt} failed: ${error instanceof Error ? error.message : error}`);
    if (attempt === 3) process.exit(1);
  }
}

const actualHash = sha256(archivePath);
if (actualHash !== pinned.sha256) {
  console.error(`sha256 mismatch for ${pinned.name}:`);
  console.error(`  expected ${pinned.sha256}`);
  console.error(`  actual   ${actualHash}`);
  process.exit(1);
}

const extractDir = path.join(cacheDir, 'extract');
fs.mkdirSync(extractDir, { recursive: true });
extract(archivePath, extractDir);

fs.mkdirSync(outDir, { recursive: true });
fs.copyFileSync(findBinary(extractDir, destName), dest);
fs.chmodSync(dest, 0o755);

if (target === `${hostPlatform}-${hostArch}`) {
  const versionOut = spawnSync(dest, ['--version'], { encoding: 'utf8' });
  const reported = versionOut.stdout?.trim();
  if (versionOut.status !== 0 || !reported?.includes(version)) {
    console.error(`injected binary failed version sanity: "${reported}" (want ${version})`);
    process.exit(1);
  }
}

fs.rmSync(cacheDir, { recursive: true, force: true });
console.log(`injected goose ${version} -> ${dest}`);
console.log(`sha256: ${actualHash}`);
