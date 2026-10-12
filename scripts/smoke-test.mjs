#!/usr/bin/env node
// Atelier smoke test: start this checkout (or an installed app folder) against a tiny local stand-in model
// endpoint, check that the web app answers with its login token and that the Atelier plugins load, then stop
// everything it started (by exact process id). Uses a throwaway home folder and port 3390 by default.
//
//   node scripts/smoke-test.mjs [--app <folder with start-preview.mjs>] [--port 3390] [--node <node binary>]
// Exit code 0 means every check passed.
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtempSync, existsSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {compareVersions, plainVersion} from '../public/atelier-updates/updater.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const app = resolve(option('--app', join(dirname(fileURLToPath(import.meta.url)), '..')));
const port = Number(option('--port', '3390'));
const node = option('--node', process.execPath);
const results = [];
const check = (name, ok, detail = '') => { results.push({name, ok}); process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}\n`); };

// 1. Pure checks of the updater's version logic.
check('version compare', compareVersions('0.1.1', '0.1.0') > 0 && compareVersions('0.1.0', '0.1.0-preview') === 0
  && compareVersions('0.2.0-rc.1', '0.2.0') < 0 && plainVersion('v0.1.0-preview') === '0.1.0');

// 2. A stand-in OpenAI-compatible endpoint on a random loopback port.
const model = createServer((req, res) => {
  res.setHeader('content-type', 'application/json');
  if (req.url.endsWith('/models')) return res.end(JSON.stringify({object: 'list', data: [{id: 'smoke-model', object: 'model'}]}));
  res.statusCode = 404; res.end('{}');
});
await new Promise(done => model.listen(0, '127.0.0.1', done));
const base = `http://127.0.0.1:${model.address().port}/v1`;

const home = mkdtempSync(join(tmpdir(), 'atelier-smoke-'));
const urlFile = join(home, 'url.json');
let output = '';
const child = spawn(node, [join(app, 'start-preview.mjs'), '--url-file', urlFile], {
  cwd: app, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: {...process.env, ATELIER_HOME: home, ATELIER_PORT: String(port), ATELIER_BASE_URL: base, ATELIER_MODEL: 'smoke-model',
    ATELIER_INGETRAZO_PORT: '4799', DSH_HOME: '', ATELIER_INSTALL_ROOT: ''},
});
child.stdout.on('data', chunk => { output += chunk; });
child.stderr.on('data', chunk => { output += chunk; });
const exited = new Promise(done => child.once('exit', code => done(code)));

const started = Date.now();
let ready = false;
while (!ready && Date.now() - started < 180000 && child.exitCode === null) {
  await new Promise(done => setTimeout(done, 500));
  ready = existsSync(urlFile);
}
check('starts and writes its address', ready, `${((Date.now() - started) / 1000).toFixed(0)} s`);
check('reaches the model endpoint', /Model endpoint OK/.test(output));
check('keeps the login token out of the log', !/token=/.test(output));
if (ready) {
  const {url} = JSON.parse(readFileSync(urlFile, 'utf8'));
  const page = await fetch(url, {redirect: 'manual'}).catch(error => ({status: error.message}));
  check('web app answers with the token', page.status === 200 || page.status === 302 || page.status === 303, `HTTP ${page.status}`);
  const anonymous = await fetch(url.replace(/\?.*$/, 'api/'), {redirect: 'manual'}).catch(() => ({status: 0}));
  check('web app refuses requests without the token', anonymous.status === 401 || anonymous.status === 403 || anonymous.status === 404, `HTTP ${anonymous.status}`);
  const cookie = (page.headers?.getSetCookie?.() ?? []).map(value => value.split(';')[0]).join('; ');
  const boot = await fetch(new URL('/', url), {headers: {cookie}}).then(r => r.text()).catch(() => '');
  check('Atelier plugins are in the page (canvas, updates, Mission Control, Brains)', boot.includes('atelier-canvas') && boot.includes('atelier-updates') && boot.includes('atelier-mission') && boot.includes('atelier-brains'));
  // Brains: with no brains.json the route answers plainly instead of failing, and it needs the sign-in like everything else.
  const brains = await fetch(new URL('/api/atelier-brains', url), {headers: {cookie}}).then(r => r.json()).catch(() => null);
  check('Brains answers (not set up yet on a fresh install)', brains?.ok === true && brains.configured === false && brains.missing === true);
  const brainsAnon = await fetch(new URL('/api/atelier-brains', url), {redirect: 'manual'}).catch(() => ({status: 0}));
  check('Brains refuses requests without the sign-in', brainsAnon.status === 401 || brainsAnon.status === 403 || brainsAnon.status === 404, `HTTP ${brainsAnon.status}`);
}
// Stop exactly what we started: the launcher, then its web-server child (found by parent process id on Windows).
const serverPid = ready ? JSON.parse(readFileSync(urlFile, 'utf8')).serverPid : undefined;
try { child.kill(); } catch { /* already gone */ }
if (serverPid) { try { process.kill(serverPid); } catch { /* already gone */ } }
const code = await Promise.race([exited, new Promise(done => setTimeout(() => done('timeout'), 15000))]);
model.close();
try { rmSync(home, {recursive: true, force: true, maxRetries: 5, retryDelay: 500}); } catch { /* the web server may still hold a file for a moment */ }
const failed = results.filter(r => !r.ok).length;
process.stdout.write(`${failed ? 'FAILED' : 'OK'}: ${results.length - failed}/${results.length} checks passed (launcher exit ${code}).\n`);
if (failed) process.stdout.write(`--- launcher output ---\n${output.slice(-3000)}\n`);
process.exit(failed ? 1 : 0);
