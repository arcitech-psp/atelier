#!/usr/bin/env node
// Create the Atelier combos (atelier-brain, atelier-fast, atelier-vision) in your local OmniRoute.
// Run once after installing OmniRoute and adding at least one provider key in its dashboard:
//   node profiles/cloud/setup-omniroute-combos.mjs
// Existing combos with the same name are left untouched. Set OMNIROUTE_CLI if `omniroute` is not on PATH.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const combos = JSON.parse(readFileSync(join(here, 'omniroute-combos.json'), 'utf8'));
const cli = process.env.OMNIROUTE_CLI || 'omniroute';
const quote = (a) => (/^[\w./:@,=-]+$/.test(a) ? a : `"${a.replace(/"/g, '\\"')}"`);
// One command string (the CLI may be "node path/to/omniroute.mjs"); every argument here is ours, not user input.
const run = (args) => spawnSync(`${cli} ${args.map(quote).join(' ')}`, { encoding: 'utf8', shell: true, windowsHide: true });

const listed = run(['combo', 'list', '--output', 'json']);
if (listed.status !== 0) {
  console.error(`Could not run "${cli} combo list". Install OmniRoute (npm install -g omniroute), start it once, then retry.`);
  console.error(listed.stderr || listed.stdout);
  process.exit(1);
}
const existing = new Set();
try {
  const parsed = JSON.parse(listed.stdout.slice(listed.stdout.indexOf('[') >= 0 && listed.stdout.indexOf('[') < (listed.stdout.indexOf('{') + 1 || Infinity) ? listed.stdout.indexOf('[') : listed.stdout.indexOf('{')));
  for (const c of Array.isArray(parsed) ? parsed : parsed.data ?? parsed.combos ?? []) existing.add(c.name);
} catch { for (const name of Object.keys(combos)) if (listed.stdout.includes(name)) existing.add(name); }

for (const [name, models] of Object.entries(combos)) {
  if (name.startsWith('_')) continue;
  if (existing.has(name)) { console.log(`${name}: already exists, left as is`); continue; }
  const made = run(['combo', 'create', name, '--strategy', 'priority', '--models', models.join(',')]);
  console.log(made.status === 0 ? `${name}: created (${models.length} entries)` : `${name}: FAILED\n${made.stderr || made.stdout}`);
}
