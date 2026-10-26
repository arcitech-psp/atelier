import test from 'node:test';
import assert from 'node:assert/strict';
import {createAgentServer, deviceReport} from '../agent.mjs';

test('device agent reports accelerator memory without requiring a supported GPU', async () => {
  const report = await deviceReport({name: 'test device', readGpu: async () => ({ok: true, gpus: [{name: 'GPU A', index: 0, vramUsedMiB: 400, vramTotalMiB: 800}]})});
  assert.equal(report.name, 'test device');
  assert.deepEqual(report.accelerators, [{id: '0', name: 'GPU A', memoryUsedMiB: 400, memoryTotalMiB: 800}]);
});


test('device agent serves a local inventory route and rejects other paths', async () => {
  const server = createAgentServer({name: 'test device', readGpu: async () => ({ok: false, gpus: []})});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await fetch(`${base}/api/atelier-mission/agent`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).name, 'test device');
    assert.equal((await fetch(`${base}/other`)).status, 404);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
