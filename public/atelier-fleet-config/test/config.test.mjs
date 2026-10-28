import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createCatalogServer, mergeManagedProviders, readManagedProviders, rollbackManagedFragment, updateManagedFragment} from '../index.mjs';

test('serves a revisioned catalog and updates a managed fragment with rollback', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'fleet-config-'));
  const configPath = path.join(dir, 'config.json'), statePath = path.join(dir, 'state.json');
  const fragmentPath = path.join(dir, 'managed.json'), logPath = path.join(dir, 'changes.jsonl');
  await writeFile(configPath, JSON.stringify({services: [], providers: [{id: 'demo', name: 'Demo', models: [{id: 'one', name: 'One'}]}]}));
  const catalog = createCatalogServer({configPath, statePath, port: 0});
  try {
    await catalog.start();
    const address = catalog.server.address(); const url = `http://127.0.0.1:${address.port}`;
    assert.equal(await updateManagedFragment({url, fragmentPath, logPath}), true);
    const first = JSON.parse(await readFile(fragmentPath, 'utf8'));
    const initialResponse = await fetch(`${url}/config`);
    assert.equal((await fetch(`${url}/config`, {headers: {'if-none-match': initialResponse.headers.get('etag')}})).status, 304);
    const providers = await readManagedProviders(fragmentPath);
    assert.equal(mergeManagedProviders({providers: {kept: {name: 'Keep'}}}, providers).providers.kept.name, 'Keep');
    assert.equal(providers[0].models[0].id, 'one');
    await writeFile(configPath, JSON.stringify({services: [], providers: [{id: 'demo', name: 'Demo', models: [{id: 'two', name: 'Two'}]}]}));
    await fetch(`${url}/refresh`, {method: 'POST'});
    assert.equal(await updateManagedFragment({url, fragmentPath, logPath}), true);
    assert.equal(JSON.parse(await readFile(fragmentPath, 'utf8')).revision, first.revision + 1);
    await rollbackManagedFragment({fragmentPath, logPath});
    assert.equal(JSON.parse(await readFile(fragmentPath, 'utf8')).hash, first.hash);
    assert.equal((await readFile(logPath, 'utf8')).trim().split('\n').length, 3);
  } finally { catalog.server.close(); await rm(dir, {recursive: true, force: true}); }
});
