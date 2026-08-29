#!/usr/bin/env node
// verify-package — W4 triple check for a Fleet package (dir or zip).
//   1. resources/bin/goose(.exe) present (+ sha256)
//   2. asar main bundle contains the fleet markers
//   3. artifact sha256 recorded for transfer verification
// Usage: node scripts/verify-package.mjs <dir-or-zip> [name.zip]
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import asar from '@electron/asar';

const MARKERS = ['New Chat on Node', 'GOOSE_USER_DATA_DIR', 'fleet://'];

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

let target = process.argv[2];
if (!target) {
  console.error('usage: verify-package.mjs <packaged-dir-or-zip>');
  process.exit(1);
}
target = path.resolve(target);

let dir = target;
if (target.endsWith('.zip')) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-verify-'));
  // Windows runners have bsdtar but no unzip; bsdtar chokes on drive-letter
  // paths ("D:..." parsed as remote host), so copy the zip in and use
  // relative paths only
  if (process.platform === 'win32') {
    fs.copyFileSync(target, path.join(tmp, 'pkg.zip'));
    execFileSync('tar', ['-xf', 'pkg.zip'], { cwd: tmp });
  } else {
    execFileSync('unzip', ['-q', target, '-d', tmp]);
  }
  dir = fs.readdirSync(tmp, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => path.join(tmp, e.name))[0];
  if (!dir) {
    console.error('no directory found inside zip');
    process.exit(1);
  }
}

// macOS bundles keep resources under <App>.app/Contents/Resources
const resourcesDir = fs.existsSync(path.join(dir, 'Contents', 'Resources'))
  ? path.join(dir, 'Contents', 'Resources')
  : path.join(dir, 'resources');

let failures = 0;

// 1. injected backend binary
const binName = process.platform === 'win32' ? 'goose.exe' : 'goose';
const resourcesBin = path.join(resourcesDir, 'bin', binName);
if (fs.existsSync(resourcesBin)) {
  const size = fs.statSync(resourcesBin).size;
  console.log(`[1/3] OK resources/bin/${binName} (${(size / 1e6).toFixed(1)} MB, sha256 ${sha256(resourcesBin)})`);
} else {
  console.error(`[1/3] FAIL resources/bin/${binName} missing in ${dir}`);
  failures++;
}

// 2. asar fleet markers (note: minification renames functions; string markers survive)
const asarPath = path.join(resourcesDir, 'app.asar');
let mainJs = '';
try {
  mainJs = asar.extractFile(asarPath, '.vite/build/main.js').toString('utf8');
} catch (error) {
  console.error(`[2/3] FAIL cannot extract .vite/build/main.js from app.asar: ${error.message}`);
  failures++;
}
if (mainJs) {
  const missing = MARKERS.filter((marker) => !mainJs.includes(marker));
  if (missing.length === 0) {
    console.log(`[2/3] OK asar main.js markers present: ${MARKERS.join(', ')}`);
  } else {
    console.error(`[2/3] FAIL asar main.js missing markers: ${missing.join(', ')}`);
    failures++;
  }
}

// 3. artifact sha256
const artifact = target.endsWith('.zip') ? target : process.argv[3];
if (artifact && fs.existsSync(artifact)) {
  console.log(`[3/3] OK artifact sha256 ${sha256(artifact)} (${path.basename(artifact)})`);
} else {
  console.log('[3/3] SKIP artifact sha256 (no zip given)');
}

process.exit(failures === 0 ? 0 : 1);
