// Atelier preview launcher: `pnpm start` (add `-- --open` to open your browser).
// Environment (all optional):
//   ATELIER_HOME       your Atelier home folder (default: ./user-home next to this file).
//                      DSH_HOME is deliberately ignored so an existing DeepSeek Harness install is never touched.
//   ATELIER_BASE_URL   your OpenAI-compatible endpoint, e.g. http://localhost:8000/v1 (used on first run)
//   ATELIER_MODEL      the model id that endpoint serves (used on first run)
//   ATELIER_CONTEXT    the model's context window in tokens (used on first run, default 32768)
//   ATELIER_TIER       "zero" or "full": which Vitruvius new chats start in (first run; small models get Zero automatically)
//   ATELIER_VISION     "1" if your model reads images (first run): Vitruvius then sees attached images and IngeTrazo screenshots
//   ATELIER_API_KEY    the endpoint's API key; leave unset for local servers that need none
//   ATELIER_PORT       the local web port (default 3081)
//   ATELIER_PROFILE    "cloud" for no local model: cloud AI through OmniRoute and/or your ChatGPT plan (first run)
//   ATELIER_CHATGPT_HOME  cloud profile: where the ChatGPT-plan sign-in is kept (default: <ATELIER_HOME>/chatgpt-plan, so installs never share a sign-in)
//   ATELIER_OMNIROUTE_START  cloud profile: command that starts OmniRoute (default: omniroute serve --port 20128 --no-open --no-tray)
//   ATELIER_LISTEN     the address the web app listens on (default localhost; WSL users may need 127.0.0.1)
//   ATELIER_BOTTEGA    "1" starts Bottega (team mode: share Atelier with paired devices on your private network) at launch,
//                      "0" keeps it off even if you switched it on before. Unset: off, unless you switched it on in the app.
//   ATELIER_BOTTEGA_PORT   the port Bottega listens on (default 3082; the next free one is used when it is busy)
//   ATELIER_BOTTEGA_BIND   advanced: listen only on these private addresses (comma separated) instead of every LAN adapter
// Options:
//   --open             open Atelier in your default browser once it is ready
//   --bottega          start with Bottega (team mode) on; prints where to pair and a pairing code. --no-bottega: keep it off
//   --url-file <path>  desktop launchers: write the address (with its login token) to this private file instead of the log
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {basename, dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createServer, createConnection} from 'node:net';
import {createRequire} from 'node:module';

const say = line => process.stdout.write(`[atelier] ${line}\n`);
const fail = (code, ...lines) => { for (const line of lines) process.stderr.write(`[atelier] ${line}\n`); process.exit(code); };

// Node 22.19+ or 24+ (the tested version is pinned in .node-version).
const [major, minor] = process.versions.node.split('.').map(Number);
if (!(major >= 24 || (major === 22 && minor >= 19))) {
  fail(1, `Atelier needs Node.js 24 (or 22.19 and newer); this is Node.js ${process.versions.node}.`,
    'Install Node.js 24 LTS from https://nodejs.org/ or use the installer from the GitHub Releases page, which brings its own.');
}

const here = dirname(fileURLToPath(import.meta.url));
// Installed by the Windows installer or the Linux/WSL archive: this file sits in <install>/versions/<version>/app.
const installed = Boolean(process.env.ATELIER_INSTALL_ROOT) || (basename(here) === 'app' && basename(dirname(dirname(here))) === 'versions');
const home = resolve(process.env.ATELIER_HOME || join(here, 'user-home'));
const argv = process.argv.slice(2);
const open = argv.includes('--open');
// Bottega (team mode) is off unless asked for: --bottega / --no-bottega beat ATELIER_BOTTEGA, which beats what the app remembers.
const bottegaEnv = argv.includes('--no-bottega') ? '0' : argv.includes('--bottega') ? '1' : process.env.ATELIER_BOTTEGA;
const urlFile = argv.includes('--url-file') ? resolve(argv[argv.indexOf('--url-file') + 1] ?? '') : null;
const listen = process.env.ATELIER_LISTEN || 'localhost';
const HOST = 'https://YOUR_OPENAI_COMPATIBLE_HOST/v1', MODEL = 'YOUR_MODEL_ID';
// First-run hook: when no model is connected yet, launchers open the Model roles page (Settings > Model roles).
const SETUP_HASH = '#model-roles';

if (!existsSync(join(here, 'node_modules')) || !existsSync(join(here, 'harness/apps/cli/lib/bin.js'))) {
  fail(1, 'Atelier is not installed completely: the packages folder (node_modules) is missing.',
    existsSync(join(here, 'pnpm-lock.yaml')) ? 'In this folder run: corepack enable, then pnpm install --frozen-lockfile' : 'Reinstall Atelier Preview.');
}

// A port is free only when nothing answers on it and we can bind it on both loopback addresses.
const answers = (host, port) => new Promise(done => {
  const socket = createConnection({host, port});
  socket.setTimeout(700, () => { socket.destroy(); done(false); });
  socket.once('connect', () => { socket.destroy(); done(true); });
  socket.once('error', () => done(false));
});
const bindable = (host, port) => new Promise(done => {
  const server = createServer();
  server.once('error', error => done(error.code === 'EADDRNOTAVAIL' || error.code === 'EAFNOSUPPORT'));
  server.listen({host, port, exclusive: true}, () => server.close(() => done(true)));
});
const portFree = async port => !(await answers('127.0.0.1', port)) && !(await answers('::1', port))
  && await bindable('127.0.0.1', port) && await bindable('::1', port);
let port;
if (process.env.ATELIER_PORT) {
  port = Number(process.env.ATELIER_PORT);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) fail(2, `ATELIER_PORT must be a number between 1024 and 65535 (got "${process.env.ATELIER_PORT}").`);
  if (!await portFree(port)) {
    fail(3, `Port ${port} is already in use, perhaps by another Atelier window or another program.`,
      `Close that program, or start on another port, e.g. ATELIER_PORT=${port + 1}.`);
  }
} else {
  for (let candidate = 3081; candidate < 3100 && port === undefined; candidate++) if (await portFree(candidate)) port = candidate;
  if (port === undefined) fail(3, 'Ports 3081 to 3099 are all in use. Set ATELIER_PORT to a free port and start again.');
  if (port !== 3081) say(`Port 3081 is busy, so Atelier uses port ${port}.`);
}
port = String(port);

mkdirSync(home, {recursive: true});
const cloud = (process.env.ATELIER_PROFILE ?? '').toLowerCase() === 'cloud';
const defaultsDir = cloud ? join(here, 'profiles', 'cloud') : join(here, 'defaults');
// First run: copy the defaults into your home, filling in any endpoint details given by environment.
const context = Number.parseInt(process.env.ATELIER_CONTEXT ?? '', 10);
// Small models start in Vitruvius Zero, the lightest profile: ATELIER_TIER=zero, or a context window of 32K tokens or
// less given in ATELIER_CONTEXT, or a model id that names 14B parameters or fewer (e.g. "qwen3.8-9b", "llama-3.1-8b").
// ATELIER_TIER=full keeps the normal Vitruvius. Either profile can be picked in the chat's profile list at any time.
const vision = /^(1|yes|on|true)$/i.test(process.env.ATELIER_VISION ?? '');
const tier = (process.env.ATELIER_TIER ?? '').toLowerCase();
const smallModel = tier === 'zero' || (tier !== 'full' && ((context > 0 && context <= 32768)
  || /(^|[^0-9.])(0?\.\d+|[1-9]|1[0-4])(\.\d+)?b(?![a-z])/i.test(process.env.ATELIER_MODEL ?? '')));
const fill = text => text
  .replaceAll(HOST, process.env.ATELIER_BASE_URL || HOST)
  .replaceAll(MODEL, process.env.ATELIER_MODEL || MODEL)
  .replace('contextWindow: 32768', `contextWindow: ${context > 0 ? context : 32768}`)
  // A vision model only sees screenshots and attached images when its entry declares image input.
  .replace(/^(\s*)contextWindow: (\d+)(\r?\n)/m, (line, indent, _n, eol) => vision && !cloud ? `${line}${indent}input: [ text, image ]${eol}` : line)
  .replace(/(default: vitruvius)(?=\r?$)/gm, smallModel ? '$1-zero' : '$1');
for (const file of ['settings.yaml', 'cordis.patch.yml']) {
  const target = join(home, file);
  if (!existsSync(target)) {
    writeFileSync(target, fill(readFileSync(join(defaultsDir, file), 'utf8')));
    if (smallModel && file === 'settings.yaml') say('Small model: new chats start in Vitruvius Zero, the lightest profile. Pick "Vitruvius" in the profile list for the full one.');
  }
}

const settings = readFileSync(join(home, 'settings.yaml'), 'utf8');
const key = process.env.ATELIER_API_KEY || 'not-needed';
const cloudSettings = settings.includes('127.0.0.1:18345');
const yaml = createRequire(join(here, 'harness/apps/cli/package.json'))('js-yaml');

// Upgrade: a home made by an earlier version keeps its own cordis.patch.yml. Add the Atelier plugins (@arcitech/*
// insert rows) that this version's defaults have and the home lacks, so new features appear after an update.
// A row the person disabled or changed keeps its id, so it is never added back.
try {
  const homePatch = join(home, 'cordis.patch.yml');
  const defaultsPatch = join(cloudSettings ? join(here, 'profiles', 'cloud') : join(here, 'defaults'), 'cordis.patch.yml');
  const homeRows = yaml.load(readFileSync(homePatch, 'utf8')) ?? [];
  const ids = new Set();
  for (const row of Array.isArray(homeRows) ? homeRows : []) {
    if (row?.id) ids.add(row.id);
    for (const item of Array.isArray(row?.insert) ? row.insert : []) if (item?.id) ids.add(item.id);
  }
  const missing = (yaml.load(readFileSync(defaultsPatch, 'utf8')) ?? []).flatMap(row => Array.isArray(row?.insert) ? row.insert : [])
    .filter(item => item?.id && typeof item.name === 'string' && item.name.startsWith('@arcitech/') && !ids.has(item.id));
  if (Array.isArray(homeRows) && missing.length > 0) {
    const text = readFileSync(homePatch, 'utf8');
    const block = `# Added when Atelier was updated: plugins that are new in this version.\n${yaml.dump([{insert: missing}])}`;
    writeFileSync(homePatch, homeRows.length === 0 ? block : `${text}${text.endsWith('\n') ? '' : '\n'}${block}`);
    say(`Updated your settings with the new Atelier parts: ${missing.map(item => item.id).join(', ')}.`);
  }
} catch (error) {
  say(`Could not check cordis.patch.yml for new Atelier parts (${error.message}); Atelier starts as before.`);
}

// Which model do new chats use? The default model route (agent-default-model) names a provider in settings.yaml;
// the Model roles page writes the brain there too. Only that route decides whether setup is still needed.
let doc = {};
try { doc = yaml.load(settings) ?? {}; } catch (error) { say(`settings.yaml could not be read (${error.message}).`); }
const route = doc?.['agent-default-model'] ?? {};
const provider = route.provider ? doc?.['llm-pi-ai']?.providers?.[route.provider] : undefined;
const base = typeof provider?.baseURL === 'string' ? provider.baseURL.replace(/\/+$/, '') : undefined;
const model = typeof route.model === 'string' ? route.model : undefined;
let bridge, setupNeeded = false;
if (cloudSettings) {
  // Cloud profile: start the local bridge (ChatGPT plan sign-in + on-demand OmniRoute). Loopback only, no window.
  const start = process.env.ATELIER_OMNIROUTE_START ?? 'omniroute serve --port 20128 --no-open --no-tray';
  bridge = spawn(process.execPath, [join(here, 'profiles', 'cloud', 'chatgpt-plan-bridge.mjs'), '--omniroute-start', start,
     '--home', process.env.ATELIER_CHATGPT_HOME || join(home, 'chatgpt-plan')],
    {cwd: here, stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true});
  bridge.stdout.on('data', chunk => process.stdout.write(chunk.toString().replace(/^/gm, '[bridge] ')));
  say('Cloud profile: OmniRoute starts on the first cloud request (dashboard http://localhost:20128 to add free-tier keys).');
  say('Your ChatGPT plan (optional): sign in once at http://127.0.0.1:18345/signin, then pick a "ChatGPT plan" model.');
} else if (!route.provider || !model || model === MODEL || base === HOST) {
  setupNeeded = true;
  say('No model is connected yet. Atelier ships no model; connect the one you use on the Model roles page');
  if (installed) {
    // The installed app: the atelier command, not the source checkout's pnpm start.
    say('  (Settings > Model roles), or from a terminal:');
    say('  atelier roles set brain --url http://localhost:11434/v1 --model your-model   (see docs/add-your-endpoint.md)');
  } else {
    say('  (Settings > Model roles), or start once with ATELIER_BASE_URL and ATELIER_MODEL set, e.g.');
    say('  ATELIER_BASE_URL=http://localhost:11434/v1 ATELIER_MODEL=your-model pnpm start   (see docs/add-your-endpoint.md)');
  }
} else if (base) {
  // One quick check against the endpoint you configured (and nowhere else), so a typo shows up now, not mid-chat.
  const routeKey = provider.apiKeyEnv === 'ATELIER_API_KEY' ? key : process.env[provider.apiKeyEnv ?? ''];
  try {
    const response = await fetch(`${base}/models`, {headers: routeKey ? {authorization: `Bearer ${routeKey}`} : {}, signal: AbortSignal.timeout(5000)});
    if (response.status === 401 || response.status === 403) {
      say(routeKey ? `The endpoint ${base} refused the API key (HTTP ${response.status}). Check the key on the Model roles page.`
        : `The endpoint ${base} asks for an API key (HTTP ${response.status}); add it on the Model roles page if chats fail.`);
    } else if (!response.ok) say(`The endpoint ${base} answered HTTP ${response.status} to /models; chats may still work if it does not list models.`);
    else {
      const ids = ((await response.json())?.data ?? []).map(entry => entry?.id).filter(Boolean);
      if (ids.length === 0 || ids.includes(model)) say(`Model endpoint OK: ${base} (model ${model}).`);
      else say(`The endpoint serves ${ids.slice(0, 8).join(', ')}, not "${model}". Pick one of those on the Model roles page.`);
    }
  } catch (error) {
    say(`Could not reach ${base} (${error?.cause?.code ?? error?.cause?.errors?.[0]?.code ?? (error?.name === 'TimeoutError' ? 'no answer in 5 s' : 'connection failed')}). Start your model server first; Atelier will still open.`);
  }
}
// IngeTrazo is optional: say once whether its local bridge answers, so a missing one is not a surprise later.
const ingetrazoPort = Number(process.env.ATELIER_INGETRAZO_PORT || 4763);
if (Number.isInteger(ingetrazoPort) && ingetrazoPort > 0 && ingetrazoPort < 65536) {
  say(await answers('127.0.0.1', ingetrazoPort)
    ? `IngeTrazo bridge found on port ${ingetrazoPort}; Vitruvius can model live in new chats.`
    : 'IngeTrazo is not running (optional). Vitruvius works on its canvas; start IngeTrazo for live modelling.');
}

const child = spawn(process.execPath,
  [join(here, 'harness/apps/cli/lib/bin.js'), 'web', ...(open ? [] : ['--no-open']), '--host', listen, '--port', port],
  {cwd: here, stdio: ['inherit', 'pipe', 'inherit'], env: {...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1', ATELIER_API_KEY: key,
    ...(bottegaEnv === undefined ? {} : {ATELIER_BOTTEGA: bottegaEnv}),
    // A pairing code goes to the terminal only when you started Atelier from one; the desktop launchers keep a log file.
    ATELIER_BOTTEGA_PRINT: !urlFile && process.stdout.isTTY ? '1' : '0',
    ATELIER_OMNIROUTE_KEY: process.env.ATELIER_OMNIROUTE_KEY || 'not-needed',
    ATELIER_CHATGPT_BRIDGE_KEY: process.env.ATELIER_CHATGPT_BRIDGE_KEY || 'not-needed'}});
let pending = '';
child.stdout.on('data', chunk => {
  pending += chunk.toString(); let end;
  while ((end = pending.indexOf('\n')) >= 0) {
    const line = pending.slice(0, end); pending = pending.slice(end + 1);
    const match = /https?:\/\/[^\s]+[?&]token=([^\s]+)/.exec(line);
    if (match) {
      writeFileSync(join(home, '.browser-launch-token'), decodeURIComponent(match[1]), {mode: 0o600});
      const url = /https?:\/\/[^\s]+/.exec(line)[0];
      if (urlFile) {
        // Desktop launchers read the address from a private file, so the login token never reaches the log.
        const setupUrl = `${url}${SETUP_HASH}`;
        writeFileSync(urlFile, JSON.stringify({url, setupUrl, setupNeeded, port: Number(port), pid: process.pid, serverPid: child.pid}), {mode: 0o600});
        say(`Atelier is running on http://localhost:${port}/${setupNeeded ? ' (first run: endpoint setup)' : ''}.`);
        continue;
      }
      say(`Atelier is running. Open this address in your browser (keep it private; it carries your login token):`);
      if (setupNeeded) say(`First run: connect your model on the Model roles page (add ${SETUP_HASH} to the address).`);
    }
    process.stdout.write(line + '\n');
  }
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { child.kill(signal); bridge?.kill(); });
child.on('exit', code => { bridge?.kill(); process.exit(code ?? 1); });
