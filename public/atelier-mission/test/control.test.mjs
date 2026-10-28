import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {MissionControl, normalizeControl} from '../control.mjs';

const ok = (body = {}) => new Response(JSON.stringify(body), {status: 200, headers: {'content-type': 'application/json'}});
async function fixture(fetch, now = () => Date.now()) {
  const dir = await mkdtemp(join(tmpdir(), 'atelier-mission-'));
  const mission = new MissionControl({file: join(dir, 'control.json'), fetch, now});
  await mission.start();
  await mission.addDevice({id: 'node-1', name: 'Workstation', address: 'http://node.test'});
  return {dir, mission, close: () => rm(dir, {recursive: true, force: true})};
}

test('normalizes addresses and drops assignments to unknown devices', () => {
  const state = normalizeControl({devices: [{id: 'n', address: 'http://node.test/'}], assignments: {chat: {deviceId: 'missing', endpoint: 'http://model.test'}}});
  assert.equal(state.devices[0].address, 'http://node.test');
  assert.deepEqual(state.assignments, {});
});

test('device probe records reachability, latency, last seen and optional accelerator inventory', async () => {
  let now = 100;
  const f = await fixture(async url => { assert.match(url, /api\/atelier-mission\/agent$/u); now += 7; return ok({accelerators: [{id: 'gpu-a', memoryTotalMiB: 24000, memoryUsedMiB: 8000}]}); }, () => now);
  try {
    const result = await f.mission.probeDevice('node-1');
    assert.equal(result.reachable, true);
    assert.equal(result.latencyMs, 7);
    assert.equal(result.lastSeen, 107);
    assert.equal(result.accelerators[0].memoryUsedMiB, 8000);
  } finally { await f.close(); }
});


test('address-only registration falls back to the device root when no agent is installed', async () => {
  let requests = 0;
  const f = await fixture(async url => { requests++; return url.endsWith('/api/atelier-mission/agent') ? new Response('{}', {status: 404}) : new Response('', {status: 200}); });
  try {
    const result = await f.mission.probeDevice('node-1');
    assert.equal(result.reachable, true);
    assert.equal(result.accelerators.length, 0);
    assert.equal(requests, 2);
  } finally { await f.close(); }
});

test('service checks are capped at once per 30 seconds and failures back off', async () => {
  let now = 1_000, calls = 0, failing = false;
  const f = await fixture(async () => { calls++; return failing ? new Response('{}', {status: 503}) : ok(); }, () => now);
  try {
    await f.mission.assign({service: 'chat', deviceId: 'node-1', endpoint: 'http://model.test', healthPath: '/health', model: 'demo'});
    calls = 0; failing = true; now += 30_000;
    const first = await f.mission.checkService('chat');
    const held = await f.mission.checkService('chat');
    assert.equal(first.state, 'offline');
    assert.equal(first.nextCheckAt, now + 30_000);
    assert.deepEqual(held, first);
    assert.equal(calls, 1);
    now += 60_000;
    const second = await f.mission.checkService('chat');
    assert.equal(second.failures, 2);
    assert.equal(second.nextCheckAt, now + 60_000);
    assert.equal(calls, 2);
  } finally { await f.close(); }
});

test('assignment tests before saving, creates a backup, and undo restores config', async () => {
  const f = await fixture(async () => ok());
  try {
    await f.mission.assign({service: 'chat', deviceId: 'node-1', gpuId: 'gpu-a', endpoint: 'http://model.test/v1', healthPath: '/health', model: 'demo'});
    assert.equal(f.mission.snapshot().assignments.chat.gpuId, 'gpu-a');
    const backup = JSON.parse(await readFile(join(f.dir, 'control.backup.json'), 'utf8'));
    assert.deepEqual(backup.state.assignments, {});
    await f.mission.undo();
    assert.deepEqual(f.mission.snapshot().assignments, {});
    assert.equal(f.mission.snapshot().devices.length, 1);
  } finally { await f.close(); }
});


test('assignment backup invokes the profile restore hook on undo', async () => {
  const restored = [];
  const f = await fixture(async () => ok());
  f.mission.onAssign = async service => ({service, role: 'brain', before: {endpoint: 'http://old.test'}});
  f.mission.onRestore = async value => restored.push(value);
  try {
    await f.mission.assign({service: 'chat', deviceId: 'node-1', endpoint: 'http://model.test', healthPath: '/health', model: 'demo'});
    await f.mission.undo();
    assert.deepEqual(restored, [{service: 'chat', role: 'brain', before: {endpoint: 'http://old.test'}}]);
  } finally { await f.close(); }
});

test('config server publish and pull use the versioned document', async () => {
  let posted;
  const f = await fixture(async (url, init = {}) => {
    if (init.method === 'POST') { posted = JSON.parse(init.body); return ok(); }
    if (url.endsWith('/api/config/current')) return ok({schemaVersion: 1, devices: [{id: 'remote', address: 'https://remote.test', name: 'Remote'}], assignments: {search: {deviceId: 'remote', endpoint: 'https://search.test', healthPath: '/health'}}});
    return ok();
  });
  try {
    await f.mission.configureServer('https://config.test');
    await f.mission.publish();
    assert.equal(posted.schemaVersion, 1);
    await f.mission.pull();
    assert.equal(f.mission.snapshot().devices[0].id, 'remote');
    assert.equal(f.mission.snapshot().assignments.search.endpoint, 'https://search.test');
  } finally { await f.close(); }
});
