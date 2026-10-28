import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const manifest = JSON.parse(await readFile(new URL('../RELEASE_MANIFEST.json', import.meta.url), 'utf8'));
const features = JSON.parse(await readFile(new URL('../public/FEATURES.json', import.meta.url), 'utf8'));
const expected = [
  ['@arcitech/atelier-studio-fast', 'public/atelier-studio-fast'],
  ['@arcitech/atelier-bimcraft-design', 'public/atelier-bimcraft-design'],
  ['@arcitech/atelier-solidcraft-recipes', 'public/atelier-solidcraft-recipes'],
];
for (const [name, path] of expected) assert.ok(manifest.packages.some((pkg) => pkg.name === name && pkg.path === path), `${name} is in the release manifest`);
assert.equal(features.channel, 'public');
assert.equal(features.modules.find((item) => item.id === 'video')?.included, false);
assert.equal(features.modules.find((item) => item.id === 'video')?.enabled, false);
assert.equal(manifest.packages.some((pkg) => /video/i.test(pkg.name)), false);

const tests = [
  'public/atelier-studio-fast/test/*.test.mjs',
  'public/atelier-bimcraft-design/test/*.test.mjs',
  'public/atelier-solidcraft-recipes/test/*.test.mjs',
];
const expanded = tests.flatMap((pattern) => {
  const folder = pattern.slice(0, pattern.lastIndexOf('/'));
  return readdirSync(folder).filter((file) => file.endsWith('.test.mjs')).map((file) => `${folder}/${file}`);
});
const run = spawnSync(process.execPath, ['--test', ...expanded], { encoding: 'utf8' });
if (run.stdout) process.stdout.write(run.stdout);
if (run.stderr) process.stderr.write(run.stderr);
assert.equal(run.status, 0, 'public module tests pass');
console.log(`Public module smoke passed: ${expected.length} packages, ${expanded.length} test files, video feature disabled.`);
