// `atelier doctor`: quick checks with a plain-English fix for each problem. Read-only: it changes nothing, and it
// talks only to this computer and to the model endpoints you configured.
import {accessSync, constants, existsSync, statfsSync} from 'node:fs';
import {createConnection} from 'node:net';
import {join} from 'node:path';
import {APP_ROOT, DSH_BIN} from './paths.mjs';
import {listRoles, testRole} from './roles.mjs';
import {readSettings, settingsPath} from './settings.mjs';
import {findServer} from './server.mjs';

export const answers = (host, port, timeoutMs = 700) => new Promise(done => {
  const socket = createConnection({host, port});
  socket.setTimeout(timeoutMs, () => { socket.destroy(); done(false); });
  socket.once('connect', () => { socket.destroy(); done(true); });
  socket.once('error', () => done(false));
});

const gb = bytes => `${(bytes / 1e9).toFixed(1)} GB`;

/** Run every check. Each result: {id, label, state: 'ok'|'warn'|'fail'|'info', detail, fix?}. */
export async function runDoctor({home, port, env = process.env, nodeVersion = process.versions.node}) {
  const checks = [];
  const add = (id, label, state, detail, fix) => checks.push({id, label, state, detail, ...fix ? {fix} : {}});

  const [major, minor] = nodeVersion.split('.').map(Number);
  if (major >= 24 || (major === 22 && minor >= 19)) add('node', 'Node.js', 'ok', `Node.js ${nodeVersion}`);
  else add('node', 'Node.js', 'fail', `Node.js ${nodeVersion} is too old.`, 'Install Node.js 24 LTS from https://nodejs.org/, or use the Atelier installer, which brings its own.');

  if (existsSync(join(APP_ROOT, 'node_modules')) && existsSync(DSH_BIN)) add('install', 'Installation', 'ok', `Complete in ${APP_ROOT}`);
  else add('install', 'Installation', 'fail', 'The packages folder (node_modules) or the DSH launcher is missing.', `In ${APP_ROOT} run: corepack enable, then pnpm install --frozen-lockfile. Or reinstall Atelier.`);

  try {
    accessSync(existsSync(home) ? home : join(home, '..'), constants.W_OK);
    add('home', 'Your Atelier folder', 'ok', home);
  } catch {
    add('home', 'Your Atelier folder', 'fail', `${home} is not writable.`, 'Check the folder permissions, or set ATELIER_HOME to a folder you own.');
  }

  try {
    const fs = statfsSync(existsSync(home) ? home : APP_ROOT);
    const free = Number(fs.bavail) * Number(fs.bsize);
    if (free < 0.5e9) add('disk', 'Disk space', 'fail', `${gb(free)} free where your chats are kept.`, 'Free up space: Atelier needs at least 0.5 GB for chats, logs and updates.');
    else if (free < 2e9) add('disk', 'Disk space', 'warn', `${gb(free)} free.`, 'Getting low. Updates keep the previous version for rollback, so leave 2 GB or more.');
    else add('disk', 'Disk space', 'ok', `${gb(free)} free`);
  } catch (error) {
    add('disk', 'Disk space', 'info', `Could not measure (${error.code ?? error.message}).`);
  }

  if (!existsSync(settingsPath(home))) {
    add('settings', 'Settings', 'warn', 'No settings yet: Atelier has not been started with this folder.', 'Run atelier web once (or the desktop launcher), or connect a brain: atelier roles set brain --url <address> --model <name>');
  } else {
    try { readSettings(home); add('settings', 'Settings', 'ok', settingsPath(home)); }
    catch (error) { add('settings', 'Settings', 'fail', error.message, `Fix the YAML in ${settingsPath(home)}, or move it aside and start Atelier again to recreate it.`); }
  }

  const server = await findServer(home).catch(() => undefined);
  if (server) add('server', 'Atelier web app', 'ok', `Running on port ${server.port} (${server.source}).`);
  else add('server', 'Atelier web app', 'info', 'Not running for this folder. The terminal UI starts it when needed.');

  const webPort = port ?? Number(env.ATELIER_PORT || 3081);
  if (!server || server.port !== webPort) {
    const busy = await answers('127.0.0.1', webPort) || await answers('::1', webPort);
    if (busy) add('port', `Port ${webPort}`, 'warn', `Port ${webPort} is used by another program.`, `Atelier picks the next free port by itself, or choose one: atelier web --port ${webPort + 1}`);
    else add('port', `Port ${webPort}`, 'ok', 'Free');
  }

  let roles = [];
  try { roles = await listRoles(home, env); } catch (error) { add('roles', 'Model roles', 'fail', error.message); }
  for (const role of roles) {
    if (!role.set) {
      if (role.required) add(`role:${role.id}`, role.name, 'fail', 'Not set. Atelier cannot answer without a brain.', 'Connect your model: atelier roles set brain --url http://localhost:8000/v1 --model <name> (or Settings > Model roles in the web app).');
      continue;
    }
    const result = await testRole(home, role.id, {env});
    const where = role.config?.baseURL ? `${role.config.model || '(no model)'} at ${role.config.baseURL}` : '';
    if (result.state === 'connected' || result.state === 'covered') add(`role:${role.id}`, role.name, 'ok', `${where} — ${result.message}`.replace(/^ — /, ''));
    else add(`role:${role.id}`, role.name, role.required ? 'fail' : 'warn', `${where}: ${result.message}`,
      result.models?.length ? `Use one of the served names: atelier roles set ${role.id} --url ${role.config.baseURL} --model ${result.models[0]}` : 'Start that server, or point the role elsewhere with atelier roles set.');
  }

  const bridgePort = Number(env.ATELIER_INGETRAZO_PORT || 4763);
  if (Number.isInteger(bridgePort) && bridgePort > 0 && bridgePort < 65536) {
    if (await answers('127.0.0.1', bridgePort)) add('ingetrazo', 'IngeTrazo bridge', 'ok', `Answers on port ${bridgePort}; Vitruvius can model live.`);
    else add('ingetrazo', 'IngeTrazo bridge', 'info', `Not running on port ${bridgePort} (optional).`, 'Start IngeTrazo for live modelling; Vitruvius works on its own canvas without it. See docs/ingetrazo.md.');
  }
  return checks;
}

export const doctorExitCode = checks => checks.some(c => c.state === 'fail') ? 1 : 0;
