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
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const home = resolve(process.env.ATELIER_HOME || join(here, 'user-home'));
const open = process.argv.slice(2).includes('--open');
const port = process.env.ATELIER_PORT ?? '3081';
const HOST = 'https://YOUR_OPENAI_COMPATIBLE_HOST/v1', MODEL = 'YOUR_MODEL_ID';

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
const say = line => process.stdout.write(`[atelier] ${line}\n`);
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
let bridge;
if (cloudSettings) {
  // Cloud profile: start the local bridge (ChatGPT plan sign-in + on-demand OmniRoute). Loopback only, no window.
  const start = process.env.ATELIER_OMNIROUTE_START ?? 'omniroute serve --port 20128 --no-open --no-tray';
  bridge = spawn(process.execPath, [join(here, 'profiles', 'cloud', 'chatgpt-plan-bridge.mjs'), '--omniroute-start', start,
     '--home', process.env.ATELIER_CHATGPT_HOME || join(home, 'chatgpt-plan')],
    {cwd: here, stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true});
  bridge.stdout.on('data', chunk => process.stdout.write(chunk.toString().replace(/^/gm, '[bridge] ')));
  say('Cloud profile: OmniRoute starts on the first cloud request (dashboard http://localhost:20128 to add free-tier keys).');
  say('Your ChatGPT plan (optional): sign in once at http://127.0.0.1:18345/signin, then pick a "ChatGPT plan" model.');
} else if (settings.includes(HOST) || settings.includes(MODEL)) {
  say('No model endpoint is set yet. Atelier ships no model; connect the one you use:');
  say(`  edit ${join(home, 'settings.yaml')} (baseURL and model id), and the model id in cordis.patch.yml,`);
  say('  or delete both files and start again with ATELIER_BASE_URL and ATELIER_MODEL set.');
  say('  Example for a local server: ATELIER_BASE_URL=http://localhost:8000/v1 ATELIER_MODEL=my-model pnpm start');
} else {
  // One quick check against the endpoint you configured (and nowhere else), so a typo shows up now, not mid-chat.
  const base = /baseURL:\s*(\S+)/.exec(settings)?.[1]?.replace(/\/+$/, '');
  const model = /-\s*id:\s*(\S+)/.exec(settings)?.[1];
  if (base) {
    try {
      const response = await fetch(`${base}/models`, {headers: {authorization: `Bearer ${key}`}, signal: AbortSignal.timeout(5000)});
      if (response.status === 401 || response.status === 403) say(`The endpoint ${base} refused the API key (HTTP ${response.status}). Set ATELIER_API_KEY.`);
      else if (!response.ok) say(`The endpoint ${base} answered HTTP ${response.status} to /models; chats may still work if it does not list models.`);
      else {
        const ids = ((await response.json())?.data ?? []).map(entry => entry?.id).filter(Boolean);
        if (!model || ids.length === 0 || ids.includes(model)) say(`Model endpoint OK: ${base}${model ? ` (model ${model})` : ''}.`);
        else say(`The endpoint serves ${ids.slice(0, 8).join(', ')}, not "${model}". Fix the model id in settings.yaml and cordis.patch.yml.`);
      }
    } catch (error) {
      say(`Could not reach ${base} (${error?.cause?.code ?? error?.cause?.errors?.[0]?.code ?? (error?.name === 'TimeoutError' ? 'no answer in 5 s' : 'connection failed')}). Start your model server first; Atelier will still open.`);
    }
  }
}

const child = spawn(process.execPath,
  [join(here, 'harness/apps/cli/lib/bin.js'), 'web', ...(open ? [] : ['--no-open']), '--host', 'localhost', '--port', port],
  {cwd: here, stdio: ['inherit', 'pipe', 'inherit'], env: {...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1', ATELIER_API_KEY: key,
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
      say(`Atelier is running. Open this address in your browser (keep it private; it carries your login token):`);
    }
    process.stdout.write(line + '\n');
  }
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { child.kill(signal); bridge?.kill(); });
child.on('exit', code => { bridge?.kill(); process.exit(code ?? 1); });
