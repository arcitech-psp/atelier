#!/usr/bin/env node
// Model roles from a terminal (for installers, WSL and headless Linux):
//   pnpm roles plan  [--tier 8gb] [--folder <dir>] [--speech]   show what "Set me up" would download and the free space
//   pnpm roles setup [--tier 8gb] [--folder <dir>] [--speech]   download and verify; Atelier starts the servers and connects them
//   pnpm roles show                                             list the roles and where each one points (keys are never shown)
//   pnpm roles open                                             print the address of the Model roles page
// Tiers: cpu, 8gb, 12gb, 16gb, 24gb. The folder defaults to the app data folder (see docs/ROLES_SETUP.md).
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Kit, defaultKitFolder} from './setup.mjs';
import {ROLES, TIERS} from './roles.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const home = resolve(process.env.ATELIER_HOME || join(repo, 'user-home'));
const rolesDir = join(home, 'atelier-roles');
const args = process.argv.slice(2), command = args[0] ?? 'help';
const flag = (name, fallback) => { const i = args.indexOf(`--${name}`); return i < 0 ? fallback : args[i + 1]; };
const options = {tier: flag('tier', '8gb'), folder: flag('folder', undefined), speech: args.includes('--speech')};
const gb = n => n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${(n / 1e6).toFixed(0)} MB`;
const say = line => process.stdout.write(line + '\n');

async function readSaved() { try { return JSON.parse(await readFile(join(rolesDir, 'roles.json'), 'utf8')); } catch { return {roles: {}, kit: {}}; } }

if (command === 'plan' || command === 'setup') {
  if (!TIERS.some(t => t.id === options.tier)) { say(`Unknown tier "${options.tier}". Use one of: ${TIERS.map(t => t.id).join(', ')}.`); process.exit(2); }
  const kit = new Kit({home: rolesDir, wire: async () => {}});
  const plan = await kit.plan(options);
  say(`Atelier "Set me up" for: ${plan.tierLabel} on ${plan.platform} (${plan.gpu ? 'Vulkan graphics build' : 'processor-only build'})`);
  say(`Folder: ${plan.folder}`);
  for (const f of plan.files) say(`  ${f.name.padEnd(46)} ${gb(f.size).padStart(8)}  ${f.licence.padEnd(10)} ${f.have === f.size ? 'already here' : f.have ? `${gb(f.have)} done` : ''}`);
  say(`To download: ${gb(plan.remaining)} (of ${gb(plan.total)}). Space needed: ${gb(plan.needed)}. Free: ${plan.free === undefined ? 'unknown' : gb(plan.free)}.`);
  say(TIERS.find(t => t.id === options.tier).advice);
  if (command === 'plan') process.exit(0);
  if (!plan.enough) { say('Not enough free space. Choose another folder with --folder.'); process.exit(1); }
  process.on('SIGINT', () => { kit.cancel(); });
  await kit.start({...options, startServers: false});
  let last = '';
  while (['downloading', 'verifying', 'unpacking', 'starting'].includes(kit.summary().job.state)) {
    const {job} = kit.summary(), line = `${job.message} ${job.total ? `${gb(job.done)} / ${gb(job.total)} (${Math.floor(100 * job.done / job.total)}%)` : ''}`;
    if (line !== last) { process.stdout.write(`\r${line.padEnd(90)}`); last = line; }
    await new Promise(r => setTimeout(r, 500));
  }
  const {job} = kit.summary();
  say(`\n${job.message}`);
  if (job.state !== 'done') process.exit(1);
  const saved = await readSaved();
  saved.kit = {folder: plan.folder, autostart: true};
  await mkdir(rolesDir, {recursive: true});
  await writeFile(join(rolesDir, 'roles.json'), JSON.stringify(saved, null, 2), {mode: 0o600});
  say('Start Atelier (pnpm start). It starts the local servers and connects the empty roles to them.');
} else if (command === 'show') {
  const saved = await readSaved();
  for (const role of ROLES) {
    const r = saved.roles?.[role.id];
    say(`${role.name.padEnd(18)} ${r?.baseURL ? `${r.model || ''} at ${r.baseURL}` : role.id === 'brain' || role.id === 'helper' ? '(kept in settings.yaml, llm-pi-ai)' : 'not set'}`);
  }
  say(`Starter kit folder: ${saved.kit?.folder || `${defaultKitFolder()} (default, not installed)`}`);
} else if (command === 'open') {
  say(`Open Atelier's address with #model-roles at the end, for example http://localhost:${process.env.ATELIER_PORT ?? '3081'}/#model-roles`);
  say('(Atelier prints its full address, including the private login token, when it starts.)');
} else {
  say('Usage: pnpm roles plan|setup [--tier cpu|8gb|12gb|16gb|24gb] [--folder <dir>] [--speech]  |  pnpm roles show  |  pnpm roles open');
}
