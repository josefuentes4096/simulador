#!/usr/bin/env node
// Bumps the `version` field across all package.json files in the workspace
// in a single shot, so a release tag corresponds to a consistent version
// across root + every package.
//
// Usage:
//   npm run version-bump 0.2.0       # explicit version
//   npm run version-bump patch       # 0.1.0 -> 0.1.1
//   npm run version-bump minor       # 0.1.0 -> 0.2.0
//   npm run version-bump major       # 0.1.0 -> 1.0.0
//
// The script only edits files. It does NOT commit, tag, or push — those are
// shown as suggested next steps after the bump succeeds.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const PACKAGE_PATHS = [
  'package.json',
  'packages/shared/package.json',
  'packages/core/package.json',
  'packages/app/package.json',
  'packages/ui/package.json',
];

function bumpSemver(version, kind) {
  const m = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) throw new Error(`Cannot parse semver from "${version}"`);
  const major = Number(m[1]);
  const minor = Number(m[2]);
  const patch = Number(m[3]);
  if (kind === 'major') return `${major + 1}.0.0`;
  if (kind === 'minor') return `${major}.${minor + 1}.0`;
  if (kind === 'patch') return `${major}.${minor}.${patch + 1}`;
  throw new Error(`Unknown bump kind "${kind}"`);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, obj) {
  const original = readFileSync(path, 'utf8');
  const trailing = original.endsWith('\n') ? '\n' : '';
  writeFileSync(path, JSON.stringify(obj, null, 2) + trailing);
}

const arg = process.argv[2];
if (!arg) {
  console.error('usage: npm run version-bump <x.y.z | patch | minor | major>');
  process.exit(1);
}

const rootPkgPath = join(repoRoot, 'package.json');
const currentVersion = readJson(rootPkgPath).version;

let nextVersion;
if (arg === 'patch' || arg === 'minor' || arg === 'major') {
  nextVersion = bumpSemver(currentVersion, arg);
} else if (/^\d+\.\d+\.\d+([-+].+)?$/.test(arg)) {
  nextVersion = arg;
} else {
  console.error(`invalid argument "${arg}". expected x.y.z or patch|minor|major`);
  process.exit(1);
}

if (nextVersion === currentVersion) {
  console.log(`already at version ${currentVersion}; nothing to do`);
  process.exit(0);
}

console.log(`${currentVersion} -> ${nextVersion}`);
console.log('');

let changed = 0;
for (const rel of PACKAGE_PATHS) {
  const path = join(repoRoot, rel);
  let pkg;
  try {
    pkg = readJson(path);
  } catch (err) {
    console.warn(`  skip ${rel}: ${err instanceof Error ? err.message : String(err)}`);
    continue;
  }
  if (typeof pkg.version !== 'string') {
    console.warn(`  skip ${rel}: no "version" field`);
    continue;
  }
  if (pkg.version !== currentVersion) {
    console.warn(`  warn ${rel}: was at "${pkg.version}" (root is "${currentVersion}")`);
  }
  pkg.version = nextVersion;
  writeJson(path, pkg);
  console.log(`  ${rel} -> ${nextVersion}`);
  changed++;
}

console.log('');
console.log(`Updated ${changed} file${changed === 1 ? '' : 's'}.`);
console.log('');
console.log('Next steps:');
console.log('  git add -u');
console.log(`  git commit -m "chore: bump version to ${nextVersion}"`);
console.log(`  git tag v${nextVersion}`);
console.log('  git push && git push --tags');
console.log('');
console.log('Pushing the tag triggers the release workflow on GitHub Actions.');
