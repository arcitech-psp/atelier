#!/usr/bin/env node
// Bottega end-to-end check: start this checkout (or an installed app folder) against a tiny stand-in model endpoint,
// switch Bottega on through the host's own RPC (what the start page's switch does), pair a second HTTP client with
// the code, load the app through the gateway, revoke the device, and check it is refused. Then switch Bottega off,
// check the port is closed, and stop everything it started (by exact process id). Throwaway home folder.
//
// Bottega listens on 127.0.0.1 here (ATELIER_BOTTEGA_BIND), so the check needs no network and never opens a port
// on your LAN. Pick ports that nothing uses; the defaults are far from Atelier's own 3081 and 3082.
//
//   node scripts/bottega-smoke.mjs [--app <folder with start-preview.mjs>] [--port 39081] [--bottega-port 39080] [--node <node binary>] [--lan]
//
// --lan runs the real thing instead: Bottega finds this computer's private network address itself and listens there,
// and the second client connects to that address (from this same computer). Use it once on a real machine; a firewall
// prompt may appear. Without it, everything stays on loopback.
// Exit code 0 means every check passed.
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdtempSync, existsSync, readFileSync, rmSync} from 'node:fs';
import {networkInterfaces, tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const app = resolve(option('--app', join(dirname(fileURLToPath(import.meta.url)), '..')));
const port = Number(option('--port', '39081'));
const bottegaPort = Number(option('--bottega-port', '39080'));
const node = option('--node', process.execPath);
const lan = args.includes('--lan');
const results = [];
const check = (name, ok, detail = '') => { results.push({name, ok}); process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}\n`); };

const model = createServer((req, res) => {
  res.setHeader('content-type', 'application/json');
  if (req.url.endsWith('/models')) return res.end(JSON.stringify({object: 'list', data: [{id: 'smoke-model', object: 'model'}]}));
  res.statusCode = 404; res.end('{}');
});
await new Promise(done => model.listen(0, '127.0.0.1', done));

const home = mkdtempSync(join(tmpdir(), 'atelier-bottega-smoke-'));
const urlFile = join(home, 'url.json');
let output = '';
const child = spawn(node, [join(app, 'start-preview.mjs'), '--url-file', urlFile], {
  cwd: app, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: {...process.env, ATELIER_HOME: home, ATELIER_PORT: String(port), ATELIER_BASE_URL: `http://127.0.0.1:${model.address().port}/v1`,
    ATELIER_MODEL: 'smoke-model', ATELIER_INGETRAZO_PORT: '4799', DSH_HOME: '', ATELIER_INSTALL_ROOT: '',
    ATELIER_BOTTEGA: '', ATELIER_BOTTEGA_BIND: lan ? '' : '127.0.0.1', ATELIER_BOTTEGA_PORT: String(bottegaPort)},
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
check('Atelier starts and writes its address', ready, `${((Date.now() - started) / 1000).toFixed(0)} s`);

const host = `http://localhost:${port}`;
const {lanInterfaces} = await import(pathToFileURL(join(app, 'public', 'atelier-start', 'bottega', 'network.mjs')).href);
const lanAddress = lanInterfaces()[0]?.address;
if (lan && !lanAddress) { process.stdout.write('FAIL  --lan needs a private network address on this computer\n'); process.exit(1); }
const gateway = `http://${lan ? lanAddress : '127.0.0.1'}:${bottegaPort}`;
/** Call a Bottega RPC on the host the way the start page does. */
const rpc = async (cookie, endpoint, payload = {}) => {
  const response = await fetch(`${host}/atelier-bottega/${endpoint}`, {method: 'POST', headers: {'content-type': 'application/json', cookie},
    body: JSON.stringify({type: 'client-request', rpcId: randomUUID(), method: endpoint, payload})});
  return {status: response.status, result: response.ok ? (await response.json()).result : undefined};
};
const cookieOf = response => (response.headers.getSetCookie?.() ?? []).map(value => value.split(';')[0]).find(Boolean);
const closed = url => fetch(url, {signal: AbortSignal.timeout(3000)}).then(() => false, () => true);

if (ready) {
  try {
    const {url} = JSON.parse(readFileSync(urlFile, 'utf8'));
    const login = await fetch(`${host}/?token=${new URL(url).searchParams.get('token')}`, {redirect: 'manual'});
    const ownerCookie = cookieOf(login);
    check('owner signs in on the host', login.status === 303 && Boolean(ownerCookie), `HTTP ${login.status}`);

    check('Bottega is off by default: its port is closed', await closed(`${gateway}/__bottega/ping`));
    const before = await rpc(ownerCookie, 'status');
    check('the host reports Bottega off', before.result?.ok === true && before.result.value.on === false);

    const on = await rpc(ownerCookie, 'enable', {on: true});
    const state = on.result?.value;
    check('Bottega switches on', on.result?.ok === true && state?.on === true && state.urls?.length === 1 && state.urls[0] === `${gateway}/`, state?.urls?.join(' '));
    check('Bottega shows a six-digit pairing code', /^\d{6}$/.test(state?.code?.code ?? ''));
    const remembered = () => { try { return JSON.parse(readFileSync(join(home, 'atelier-bottega', 'settings.json'), 'utf8')).enabled; } catch { return undefined; } };
    check('the switch is remembered for the next start', remembered() === true);

    const anonymous = await fetch(`${gateway}/`, {redirect: 'manual', headers: {accept: 'text/html', 'sec-fetch-dest': 'document'}});
    check('an unpaired client is sent to the pairing page', anonymous.status === 302 && anonymous.headers.get('location') === '/__bottega/pair', `HTTP ${anonymous.status}`);
    const anonymousApi = await fetch(`${gateway}/atelier-start/status`, {method: 'POST', redirect: 'manual'});
    check('an unpaired client reaches nothing', anonymousApi.status === 401, `HTTP ${anonymousApi.status}`);

    const wrong = await fetch(`${gateway}/__bottega/pair`, {method: 'POST', redirect: 'manual', headers: {'content-type': 'application/x-www-form-urlencoded', origin: gateway},
      body: new URLSearchParams({code: state.code.code === '000000' ? '111111' : '000000'})});
    check('a wrong code is refused', wrong.status === 401 && !cookieOf(wrong), `HTTP ${wrong.status}`);

    const paired = await fetch(`${gateway}/__bottega/pair`, {method: 'POST', redirect: 'manual', headers: {'content-type': 'application/x-www-form-urlencoded', origin: gateway},
      body: new URLSearchParams({code: state.code.code, name: 'Smoke tablet'})});
    const deviceCookie = cookieOf(paired);
    check('the right code pairs a second client', paired.status === 303 && Boolean(deviceCookie), `HTTP ${paired.status}`);
    check('the device cookie is not the host\'s login', !(deviceCookie ?? '').startsWith('dsh-auth-'));
    const stored = readFileSync(join(home, 'atelier-bottega', 'devices.json'), 'utf8');
    check('the device token is stored only as a hash', stored.includes('"hash"') && !stored.includes((deviceCookie ?? '=').split('=')[1]));

    const chat = await fetch(`${gateway}/`, {headers: {cookie: deviceCookie, accept: 'text/html', 'sec-fetch-dest': 'document'}});
    const html = await chat.text();
    check('the Atelier page loads through the gateway', chat.status === 200 && html.includes('atelier-canvas') && html.includes('atelier-start'), `HTTP ${chat.status}, ${html.length} bytes`);
    const through = await fetch(`${gateway}/atelier-start/status`, {method: 'POST', headers: {cookie: deviceCookie, origin: gateway, 'content-type': 'application/json'},
      body: JSON.stringify({type: 'client-request', rpcId: randomUUID(), method: 'status', payload: {}})});
    check('an app call works through the gateway', through.status === 200 && (await through.json()).result?.ok === true, `HTTP ${through.status}`);
    const manage = await fetch(`${gateway}/atelier-bottega/status`, {method: 'POST', headers: {cookie: deviceCookie, origin: gateway, 'content-type': 'application/json'},
      body: JSON.stringify({type: 'client-request', rpcId: randomUUID(), method: 'status', payload: {}})});
    check('a paired device cannot manage Bottega', manage.status === 403, `HTTP ${manage.status}`);

    const listed = await rpc(ownerCookie, 'status');
    const device = listed.result?.value?.devices?.[0];
    check('the owner sees the paired device', listed.result?.value?.devices?.length === 1 && device?.name === 'Smoke tablet');
    const revoked = await rpc(ownerCookie, 'revoke', {id: device?.id});
    check('the owner revokes it', revoked.result?.ok === true && revoked.result.value.devices.length === 0);
    const after = await fetch(`${gateway}/`, {redirect: 'manual', headers: {cookie: deviceCookie, accept: 'text/html', 'sec-fetch-dest': 'document'}});
    const afterApi = await fetch(`${gateway}/atelier-start/status`, {method: 'POST', redirect: 'manual', headers: {cookie: deviceCookie, origin: gateway}});
    check('the revoked device is refused', after.status === 302 && afterApi.status === 401, `HTTP ${after.status} / ${afterApi.status}`);

    const off = await rpc(ownerCookie, 'enable', {on: false});
    check('Bottega switches off and its port closes', off.result?.value?.on === false && await closed(`${gateway}/__bottega/ping`));
    check('off is remembered too', remembered() === false);
    // The host must not answer on this computer's own network address (it listens on localhost only), Bottega on or off.
    const hostLan = Object.values(networkInterfaces()).flat().find(a => a && a.family === 'IPv4' && !a.internal)?.address;
    check('the host itself stays on localhost', hostLan === undefined || await closed(`http://${hostLan}:${port}/`), hostLan ? `tried ${hostLan}` : 'no network address to try');
    check('no pairing code or token reached the log', !/token=/.test(output) && !new RegExp(String.raw`\b${state.code.code}\b`).test(output));
  } catch (error) {
    check('end-to-end run', false, error?.stack ?? String(error));
  }
}

// Stop exactly what we started: the launcher, then its web-server child.
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
