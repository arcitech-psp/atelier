import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ACTION_TYPES, buildCommand, configuredManager, createBrainManager, createBrainsHandler, genericLive, loadConfigFile, parseTokensPerSecond, validateConfig} from '../core.mjs';

const winMachine = (extra = {}) => ({
  id: 'box', name: 'Box PC', gpu: 'RTX 4070', vramGb: 16, transport: {type: 'ssh', host: 'gpu-box-ssh', os: 'windows'},
  brains: [
    {id: 'fast', name: 'Fast', engine: 'engine-a', port: 8301, vramGb: 15, start: [{type: 'schtask-run', task: 'Fast 8301'}], stop: [{type: 'kill-port', port: 8301}], logFile: 'C:/logs/fast.log'},
    {id: 'big', name: 'Big', engine: 'llama.cpp', port: 8291, vramGb: 15, loadTimeoutSec: 30, start: [{type: 'schtask-run', task: 'Big 8291'}], stop: [{type: 'kill-port', port: 8291}]},
  ],
  ...extra,
});
const rawConfig = (machine = winMachine()) => ({version: 1, machines: [machine]});
const valid = raw => { const r = validateConfig(raw); assert.equal(r.ok, true, r.errors.join('\n')); return r.config; };

// ---- config validation ----------------------------------------------------------------------------------------------

test('a good config validates and gets defaults', () => {
  const config = valid(rawConfig());
  assert.equal(config.machines[0].control, 'full');
  assert.equal(config.machines[0].exclusive, true);
  assert.equal(config.machines[0].brains[0].healthUrl, 'http://127.0.0.1:8301/v1/models');
  assert.equal(config.machines[0].brains[0].loadTimeoutSec, 180);
});

test('the shipped example configs validate', async () => {
  const {existsSync} = await import('node:fs');
  for (const path of [new URL('../brains.json', import.meta.url), new URL('../../brains.json', import.meta.url), new URL('../brains.example.json', import.meta.url)]) {
    if (!existsSync(path)) continue;
    const result = loadConfigFile(path);
    assert.equal(result.ok, true, `${path}: ${result.errors.join('; ')}`);
  }
});

test('config problems are reported in plain words, all at once', () => {
  const raw = rawConfig(winMachine({id: 'Bad Id', name: '', brains: [
    {id: 'a', name: 'A', engine: 'x', port: 70000, vramGb: 99, start: [{type: 'rm-rf'}], stop: []},
    {id: 'a', name: 'A2', engine: 'x', port: 1, vramGb: 1, start: [{type: 'kill-port', port: 1}], stop: [{type: 'kill-port', port: 1}]},
  ]}));
  const r = validateConfig(raw);
  assert.equal(r.ok, false);
  const text = r.errors.join('\n');
  assert.match(text, /machines\[0\]\.id/);
  assert.match(text, /port: needs a port number/);
  assert.match(text, /does not fit on a 16 GB card/);
  assert.match(text, /"rm-rf" is not allowed/);
  assert.match(text, /"a" is used twice/);
});

test('only the closed set of action types is accepted, and free-form commands are refused', () => {
  assert.deepEqual([...ACTION_TYPES].sort(), ['kill-port', 'schtask-end', 'schtask-run', 'spawn', 'systemd']);
  for (const bad of [{type: 'command', command: 'whoami'}, {type: 'shell', script: 'x'}, {type: 'schtask-run', task: "x'; Remove-Item C:\\ #"}, {type: 'schtask-run', task: 'a`b'}, {type: 'kill-port', port: '8301; calc'}, {type: 'kill-port', port: 0}]) {
    const m = winMachine(); m.brains[0].start = [bad];
    assert.equal(validateConfig(rawConfig(m)).ok, false, JSON.stringify(bad));
  }
});

test('action types are checked against the computer they run on', () => {
  const linux = {id: 'box', name: 'Box', gpu: 'RTX', vramGb: 24, transport: {type: 'local', os: 'linux'},
    brains: [{id: 'a', name: 'A', engine: 'vLLM', port: 8000, vramGb: 10, start: [{type: 'schtask-run', task: 'X'}], stop: [{type: 'kill-port', port: 8000}]}]};
  assert.match(validateConfig(rawConfig(linux)).errors.join(), /only works on Windows/);
  const win = winMachine(); win.brains[0].start = [{type: 'systemd', unit: 'a.service', verb: 'start'}];
  assert.match(validateConfig(rawConfig(win)).errors.join(), /systemd only works on Linux/);
  const remoteSpawn = winMachine(); remoteSpawn.brains[0].start = [{type: 'spawn', file: 'C:/x/server.exe', args: []}];
  assert.match(validateConfig(rawConfig(remoteSpawn)).errors.join(), /spawn can only start programs on this same computer/);
  const local = {id: 'pc', name: 'PC', gpu: 'RTX', vramGb: 24, transport: {type: 'local', os: 'linux'},
    brains: [{id: 'a', name: 'A', engine: 'llama.cpp', port: 8080, vramGb: 8, start: [{type: 'spawn', file: '/usr/bin/llama-server', args: ['-m', '/m/a.gguf', '--port', '8080']}], stop: [{type: 'kill-port', port: 8080}]}]};
  valid(rawConfig(local));
  local.brains[0].start[0].file = '/usr/bin/../../bin/sh';
  assert.equal(validateConfig(rawConfig(local)).ok, false);
});

test('a controllable computer needs start and stop; a view-only one does not', () => {
  const m = winMachine(); m.brains[0].stop = [];
  assert.match(validateConfig(rawConfig(m)).errors.join(), /needs a way to stop/);
  const view = winMachine({control: 'view'}); view.brains.forEach(b => { b.start = []; b.stop = []; });
  valid(rawConfig(view));
});

test('duplicate computers and empty lists are refused', () => {
  assert.equal(validateConfig({machines: []}).ok, false);
  assert.equal(validateConfig({machines: [winMachine(), winMachine()]}).ok, false);
  assert.equal(validateConfig(null).ok, false);
  assert.equal(validateConfig({version: 2, machines: [winMachine()]}).ok, false);
});

// ---- commands -------------------------------------------------------------------------------------------------------

test('commands are built from the config only; the stop acts on the port owner, never a name', () => {
  const machine = valid(rawConfig()).machines[0];
  const cmd = buildCommand(machine, machine.brains[0].stop[0]);
  assert.equal(cmd.file, 'ssh');
  assert.equal(cmd.args[2 + 2], 'gpu-box-ssh');
  const encoded = /-EncodedCommand (\S+)/u.exec(cmd.args.at(-1))[1];
  const script = Buffer.from(encoded, 'base64').toString('utf16le');
  assert.match(script, /Get-NetTCPConnection -State Listen -LocalPort 8301/);
  assert.match(script, /Stop-Process -Id \$i -Force/);
  assert.doesNotMatch(script, /taskkill|Stop-Process -Name|-Name/);
  const run = Buffer.from(/-EncodedCommand (\S+)/u.exec(buildCommand(machine, machine.brains[0].start[0]).args.at(-1))[1], 'base64').toString('utf16le');
  assert.match(run, /Start-ScheduledTask -TaskName 'Fast 8301'/);
});

test('local Windows and Linux commands run without a shell window', () => {
  const local = valid(rawConfig({id: 'pc', name: 'PC', gpu: 'RTX', vramGb: 24, transport: {type: 'local', os: 'windows'}, brains: [{id: 'a', name: 'A', engine: 'x', port: 8080, vramGb: 5, start: [{type: 'schtask-run', task: 'A'}], stop: [{type: 'kill-port', port: 8080}]}]})).machines[0];
  assert.equal(buildCommand(local, local.brains[0].stop[0]).file, 'powershell.exe');
  const linux = valid(rawConfig({id: 'bx', name: 'Box', gpu: 'RTX', vramGb: 24, transport: {type: 'ssh', host: 'bx', os: 'linux'}, brains: [{id: 'a', name: 'A', engine: 'x', port: 8080, vramGb: 5, start: [{type: 'systemd', unit: 'a.service', verb: 'restart'}], stop: [{type: 'systemd', unit: 'a.service', verb: 'stop'}]}]})).machines[0];
  const cmd = buildCommand(linux, linux.brains[0].start[0]);
  assert.equal(cmd.file, 'ssh');
  assert.match(cmd.args.at(-1), /base64 -d \| sh$/);
  const script = Buffer.from(/echo (\S+) \|/u.exec(cmd.args.at(-1))[1], 'base64').toString();
  assert.equal(script, 'systemctl restart a.service && echo restarted');
});

// ---- the manager and its guard ---------------------------------------------------------------------------------------

/** A fake world: two brains share one card; start/stop commands change what "answers". */
function world({startDelayMs = 6000, failStart = false, hangBrain = null} = {}) {
  const clock = {t: 1_000_000};
  const w = {clock, up: new Set(), log: [], commands: [], startsAt: new Map()};
  const names = {'Fast 8301': 'fast', 'Big 8291': 'big'};
  w.now = () => clock.t;
  w.sleep = async ms => { clock.t += ms; };
  w.live = async machine => Object.fromEntries(machine.brains.map(b => {
    const due = w.startsAt.get(b.id);
    if (due !== undefined && clock.t >= due && !w.up.has(b.id) && b.id !== hangBrain) w.up.add(b.id);
    return [b.id, {up: w.up.has(b.id), modelName: `${b.name} (live)`, tps: w.up.has(b.id) ? 42 : null}];
  }));
  w.exec = async cmd => {
    const script = cmd.args ? Buffer.from(/-EncodedCommand (\S+)/u.exec(cmd.args.at(-1))?.[1] ?? '', 'base64').toString('utf16le') : '';
    w.commands.push(script);
    const run = /Start-ScheduledTask -TaskName '([^']+)'/u.exec(script);
    if (run) { if (failStart) return {ok: false, code: 1, stdout: '', stderr: 'Task not found'}; const id = names[run[1]]; w.log.push(`start ${id}`); w.startsAt.set(id, clock.t + startDelayMs); return {ok: true, code: 0, stdout: 'started', stderr: ''}; }
    const kill = /-LocalPort (\d+)/u.exec(script);
    if (kill) { const id = kill[1] === '8301' ? 'fast' : 'big'; w.log.push(`stop ${id}`); w.up.delete(id); w.startsAt.delete(id); return {ok: true, code: 0, stdout: 'killed 99', stderr: ''}; }
    if (/Get-Content/u.test(script)) return {ok: true, code: 0, stdout: 'line one\nCUDA out of memory\n', stderr: ''};
    return {ok: false, code: 2, stdout: '', stderr: 'unexpected'};
  };
  return w;
}
const manager = (w, raw = rawConfig(), extra = {}) => createBrainManager({config: valid(raw), exec: w.exec, live: w.live, now: w.now, sleep: w.sleep, pollMs: 1000, settleMs: 5000, ...extra});

test('load on an empty card starts the brain and waits for the real server', async () => {
  const w = world(); const m = manager(w);
  const r = m.act('load', {machine: 'box', brainId: 'fast'});
  assert.equal(r.ok, true);
  const mid = (await m.status()).machines[0];
  assert.equal(mid.state, 'loading');
  assert.equal(mid.op.running, true);
  await m.whenIdle();
  const s = (await m.status()).machines[0];
  assert.equal(s.state, 'loaded');
  assert.equal(s.loaded.brainId, 'fast');
  assert.equal(s.loaded.modelName, 'Fast (live)');
  assert.equal(s.op.ok, true);
  assert.equal(s.op.message, 'Fast is loaded.');
});

test('loading a second brain unloads the first one before starting (one brain per card)', async () => {
  const w = world(); const m = manager(w);
  m.act('load', {machine: 'box', brainId: 'fast'}); await m.whenIdle();
  w.log.length = 0;
  m.act('load', {machine: 'box', brainId: 'big'}); await m.whenIdle();
  assert.deepEqual(w.log, ['stop fast', 'start big']);
  const s = (await m.status()).machines[0];
  assert.equal(s.loaded.brainId, 'big');
  assert.equal(s.brains.find(b => b.id === 'fast').loaded, false);
});

test('two actions can not overlap on one computer', async () => {
  const w = world(); const m = manager(w);
  assert.equal(m.act('load', {machine: 'box', brainId: 'fast'}).ok, true);
  const second = m.act('load', {machine: 'box', brainId: 'big'});
  assert.equal(second.ok, false);
  assert.equal(second.status, 409);
  assert.match(second.error, /Box PC is busy/);
  assert.equal(m.act('unload', {machine: 'box', brainId: 'fast'}).status, 409);
  await m.whenIdle();
  assert.equal(m.act('unload', {machine: 'box', brainId: 'fast'}).ok, true);
  await m.whenIdle();
});

test('different computers can work at the same time', async () => {
  const two = rawConfig(); two.machines.push({...winMachine({id: 'second', name: 'Second'})});
  const w = world(); const m = manager(w, two);
  assert.equal(m.act('load', {machine: 'box', brainId: 'fast'}).ok, true);
  assert.equal(m.act('load', {machine: 'second', brainId: 'big'}).ok, true);
  await m.whenIdle();
});

test('the guard is released after a failure, so the next try is allowed', async () => {
  const w = world({failStart: true}); const m = manager(w);
  m.act('load', {machine: 'box', brainId: 'fast'}); await m.whenIdle();
  const s = (await m.status()).machines[0];
  assert.equal(s.state, 'failed');
  assert.match(s.op.message, /Could not start Fast: Task not found/);
  assert.match(s.op.logTail, /CUDA out of memory/);
  assert.equal(m.act('load', {machine: 'box', brainId: 'big'}).ok, true);
  await m.whenIdle();
});

test('a brain that never answers fails with a timeout and the last log lines', async () => {
  const w = world({hangBrain: 'big'}); const m = manager(w);
  m.act('load', {machine: 'box', brainId: 'big'}); await m.whenIdle();
  const s = (await m.status()).machines[0];
  assert.equal(s.state, 'failed');
  assert.match(s.op.message, /Big did not become ready within 30 s/);
  assert.equal(s.loaded, null);
  assert.equal(w.commands.some(c => /Get-Content/u.test(c)), false, 'no log file configured for Big, so no log is read');
  const f = world({hangBrain: 'fast'}); const m2 = manager(f, rawConfig(), {});
  m2.act('load', {machine: 'box', brainId: 'fast'}); await m2.whenIdle();
  const s2 = (await m2.status()).machines[0];
  assert.match(s2.op.message, /did not become ready within 180 s/);
  assert.match(s2.op.logTail, /CUDA out of memory/);
});

test('unload stops only the chosen brain and shows the card as free', async () => {
  const w = world(); const m = manager(w);
  m.act('load', {machine: 'box', brainId: 'fast'}); await m.whenIdle();
  w.log.length = 0;
  m.act('unload', {machine: 'box', brainId: 'fast'}); await m.whenIdle();
  assert.deepEqual(w.log, ['stop fast']);
  const s = (await m.status()).machines[0];
  assert.equal(s.state, 'empty');
  assert.match(s.op.message, /Fast is unloaded\. Box PC is free\./);
});

test('a stopped brain shows as unloaded at once even while the server signal lags', async () => {
  const w = world(); const m = manager(w);
  m.act('load', {machine: 'box', brainId: 'fast'}); await m.whenIdle();
  // the stop command works, but the live signal keeps saying "up" for a while (a metrics sample that has not gone stale yet)
  const realExec = w.exec; const stuck = {up: true};
  const m2 = createBrainManager({config: valid(rawConfig()), exec: async cmd => { const r = await realExec(cmd); return r; }, live: async machine => ({fast: {up: stuck.up}, big: {up: false}}), now: w.now, sleep: w.sleep, pollMs: 1000, settleMs: 3000});
  m2.act('unload', {machine: 'box', brainId: 'fast'}); await m2.whenIdle();
  const s = (await m2.status()).machines[0];
  assert.equal(s.loaded, null);
  assert.equal(s.state, 'empty');
});

test('reload restarts the same brain: stop, then start', async () => {
  const w = world(); const m = manager(w);
  m.act('load', {machine: 'box', brainId: 'fast'}); await m.whenIdle();
  w.log.length = 0;
  m.act('reload', {machine: 'box', brainId: 'fast'}); await m.whenIdle();
  assert.deepEqual(w.log, ['stop fast', 'stop big', 'start fast']);
  assert.equal((await m.status()).machines[0].loaded.brainId, 'fast');
});

test('loading what is already loaded does nothing', async () => {
  const w = world(); const m = manager(w);
  m.act('load', {machine: 'box', brainId: 'fast'}); await m.whenIdle();
  w.log.length = 0;
  m.act('load', {machine: 'box', brainId: 'fast'}); await m.whenIdle();
  assert.deepEqual(w.log, []);
  assert.match((await m.status()).machines[0].op.message, /already loaded/);
});

test('view-only computers, unknown ids and bad actions are refused', async () => {
  const view = winMachine({control: 'view', id: 'viewer', name: 'Viewer'}); view.brains.forEach(b => { b.start = []; b.stop = []; });
  const w = world(); const m = manager(w, {version: 1, machines: [winMachine(), view]});
  assert.equal(m.act('load', {machine: 'viewer', brainId: 'fast'}).status, 403);
  assert.match(m.act('load', {machine: 'viewer', brainId: 'fast'}).error, /view only/);
  assert.equal(m.act('load', {machine: 'nope', brainId: 'fast'}).status, 404);
  assert.equal(m.act('load', {machine: 'box', brainId: 'nope'}).status, 404);
  assert.equal(m.act('format-disk', {machine: 'box', brainId: 'fast'}).status, 400);
  assert.equal(m.act('load', {machine: {x: 1}, brainId: 'fast'}).status, 404);
  assert.deepEqual(w.commands, []);
  const s = await m.status();
  assert.equal(s.machines.find(x => x.id === 'viewer').control, 'view');
});

test('a live provider that throws gives an honest unknown state, not a made-up brain', async () => {
  const w = world(); const m = createBrainManager({config: valid(rawConfig()), exec: w.exec, live: async () => { throw Error('ssh timed out'); }, now: w.now, sleep: w.sleep});
  const s = (await m.status()).machines[0];
  assert.equal(s.state, 'unknown');
  assert.equal(s.loaded, null);
  assert.match(s.error, /ssh timed out/);
});

test('the audit callback gets one line per finished action', async () => {
  const lines = []; const w = world(); const m = manager(w, rawConfig(), {audit: e => lines.push(e)});
  m.act('load', {machine: 'box', brainId: 'fast'}); await m.whenIdle();
  assert.equal(lines.length, 1);
  assert.equal(lines[0].ok, true);
  assert.equal(lines[0].brain, 'fast');
});

// ---- live probes, handler, hot config --------------------------------------------------------------------------------

test('the generic live probe asks each brain\'s own server', async () => {
  const machine = valid(rawConfig({id: 'pc', name: 'PC', gpu: 'RTX', vramGb: 24, transport: {type: 'local', os: 'linux'}, brains: [
    {id: 'a', name: 'A', engine: 'llama.cpp', port: 8080, vramGb: 5, metricsUrl: 'http://127.0.0.1:8080/metrics', start: [{type: 'systemd', unit: 'a.service', verb: 'start'}], stop: [{type: 'systemd', unit: 'a.service', verb: 'stop'}]},
    {id: 'b', name: 'B', engine: 'vLLM', port: 8000, vramGb: 5, start: [{type: 'systemd', unit: 'b.service', verb: 'start'}], stop: [{type: 'systemd', unit: 'b.service', verb: 'stop'}]},
  ]})).machines[0];
  const fetchImpl = async url => {
    if (url.includes(':8080/v1')) return {ok: true, json: async () => ({data: [{id: 'qwen3-14b'}]})};
    if (url.includes(':8080/metrics')) return {ok: true, text: async () => '# HELP\nllamacpp:predicted_tokens_seconds 61.5\n'};
    throw Error('connection refused');
  };
  const out = await genericLive({fetchImpl})(machine);
  assert.deepEqual(out, {a: {up: true, modelName: 'qwen3-14b', tps: 61.5}, b: {up: false}});
  assert.equal(parseTokensPerSecond('llamacpp:predicted_tokens_seconds 0'), null);
});

function fakeRes() { return {code: 0, body: '', writeHead(c) { this.code = c; }, end(b) { this.body = b ?? ''; }}; }
function fakeReq(method, url, headers = {}, body = '') {
  const handlers = {};
  const req = {method, url, headers, on(e, f) { handlers[e] = f; return req; }, destroy() {}};
  queueMicrotask(() => { if (body) handlers.data?.(Buffer.from(body)); handlers.end?.(); });
  return req;
}

test('the HTTP handler: GET shows the state; POST needs the Atelier header and cannot be cross-site', async () => {
  const w = world(); const m = manager(w);
  const handler = createBrainsHandler({authorizeIndex: () => true, getManager: () => ({manager: m})});
  let res = fakeRes(); await handler(fakeReq('GET', '/api/atelier-brains'), res);
  assert.equal(res.code, 200); assert.equal(JSON.parse(res.body).machines[0].id, 'box');
  res = fakeRes(); await handler(fakeReq('POST', '/api/atelier-brains/load', {}, '{"machine":"box","brainId":"fast"}'), res);
  assert.equal(res.code, 403);
  res = fakeRes(); await handler(fakeReq('POST', '/api/atelier-brains/load', {'x-atelier-brains': '1', 'sec-fetch-site': 'cross-site'}, '{"machine":"box","brainId":"fast"}'), res);
  assert.equal(res.code, 403);
  res = fakeRes(); await handler(fakeReq('POST', '/api/atelier-brains/load', {'x-atelier-brains': '1'}, 'not json'), res);
  assert.equal(res.code, 400);
  res = fakeRes(); await handler(fakeReq('POST', '/api/atelier-brains/format', {'x-atelier-brains': '1'}, '{}'), res);
  assert.equal(res.code, 405);
  res = fakeRes(); await handler(fakeReq('POST', '/api/atelier-brains/load', {'x-atelier-brains': '1'}, '{"machine":"box","brainId":"fast"}'), res);
  assert.equal(res.code, 202);
  res = fakeRes(); await handler(fakeReq('POST', '/api/atelier-brains/load', {'x-atelier-brains': '1'}, '{"machine":"box","brainId":"big"}'), res);
  assert.equal(res.code, 409);
  await m.whenIdle();
  res = fakeRes(); await handler(fakeReq('GET', '/api/other'), res);
  assert.equal(res.code, 404);
});

test('the handler says so plainly when brains.json is missing or wrong', async () => {
  const handler = createBrainsHandler({authorizeIndex: () => true, getManager: () => ({errors: ['brains.json was not found.'], missing: true})});
  const res = fakeRes(); await handler(fakeReq('GET', '/api/atelier-brains'), res);
  const body = JSON.parse(res.body);
  assert.equal(body.configured, false); assert.equal(body.missing, true);
});

test('brains.json is re-read when it changes, and a broken edit keeps the last good list', () => {
  let mtime = 1, content = JSON.stringify(rawConfig());
  const path = join(mkdtempSync(join(tmpdir(), 'brains-')), 'brains.json');
  writeFileSync(path, content);
  const get = configuredManager({path, live: async () => ({}), exec: async () => ({ok: true, stdout: ''}), statImpl: () => mtime});
  assert.equal(get().manager.config.machines.length, 1);
  const two = rawConfig(); two.machines.push(winMachine({id: 'second', name: 'Second'}));
  writeFileSync(path, JSON.stringify(two)); mtime = 2;
  assert.equal(get().manager.config.machines.length, 2);
  writeFileSync(path, '{ broken'); mtime = 3;
  const bad = get();
  assert.equal(bad.manager.config.machines.length, 2);
  assert.ok(bad.errors.length > 0);
});


// ---- the real thing on this computer: hidden spawn, the server's own answer, stop by the exact port owner -------------------

test('end to end on this computer: load starts a real server, unload stops only its port owner', {timeout: 120_000}, async () => {
  const {createServer} = await import('node:net');
  const free = await new Promise(resolve => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const {port} = s.address(); s.close(() => resolve(port)); }); });
  const dir = mkdtempSync(join(tmpdir(), 'brains-e2e-'));
  const script = join(dir, 'fake-brain.mjs');
  writeFileSync(script, `import http from 'node:http';
http.createServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({data: [{id: 'fake-model-1b'}]})); }).listen(${free}, '127.0.0.1');
setInterval(() => {}, 1000);
`);
  const config = valid({version: 1, machines: [{id: 'here', name: 'This computer', gpu: 'Test card', vramGb: 8, transport: {type: 'local'}, brains: [
    {id: 'fake', name: 'Fake 1B', engine: 'test', port: free, vramGb: 1, loadTimeoutSec: 60, unloadTimeoutSec: 30,
      start: [{type: 'spawn', file: process.execPath, args: [script]}], stop: [{type: 'kill-port', port: free}]},
  ]}]});
  const m = createBrainManager({config, live: genericLive({timeoutMs: 800}), pollMs: 400, settleMs: 15_000});
  assert.equal((await m.status()).machines[0].state, 'empty');
  assert.equal(m.act('load', {machine: 'here', brainId: 'fake'}).ok, true);
  await m.whenIdle();
  let s = (await m.status()).machines[0];
  assert.equal(s.op.ok, true, s.op.message);
  assert.equal(s.state, 'loaded');
  assert.equal(s.loaded.modelName, 'fake-model-1b');
  assert.equal(m.act('unload', {machine: 'here', brainId: 'fake'}).ok, true);
  await m.whenIdle();
  s = (await m.status()).machines[0];
  assert.equal(s.op.ok, true, s.op.message);
  assert.equal(s.state, 'empty');
  assert.equal((await genericLive({timeoutMs: 500})(config.machines[0])).fake.up, false, 'the server really stopped');
});

test('before the first reading arrives the state is "checking", not "nothing loaded"', async () => {
  const w = world(); const m = createBrainManager({config: valid(rawConfig()), exec: w.exec, live: async () => ({_checking: true}), now: w.now, sleep: w.sleep});
  const s = (await m.status()).machines[0];
  assert.equal(s.state, 'checking');
  assert.equal(s.loaded, null);
});
