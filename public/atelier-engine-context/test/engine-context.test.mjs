import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {after, test} from 'node:test';
import {PRIVATE_HOST, createEngineContext, entryWindow, healthWindow, modelWindow} from '../index.mjs';

const quiet = {info() {}, warn() {}};
const servers = [];
after(() => { for (const s of servers) s.close(); });

/** Local engine stand-in: answers /v1/models and /health from a mutable reply table. */
async function engine(replies) {
  const seen = [];
  const server = createServer((req, res) => {
    seen.push({path: req.url, method: req.method, auth: req.headers.authorization});
    const body = replies[req.url];
    if (body === undefined) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, {'content-type': 'application/json'});
    res.end(JSON.stringify(body));
  });
  servers.push(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {url: `http://127.0.0.1:${server.address().port}`, seen, replies};
}

const route = (baseURL, contextWindow = 65_536, extra = {}) => ({engine: {baseURL, models: [{id: 'm', contextWindow}], ...extra}});

test('pure readers: vLLM, llama.cpp-style meta, LoRA parent, alias, health', () => {
  assert.deepEqual(entryWindow({id: 'a', max_model_len: 98_304}, []), {window: 98_304, source: 'max_model_len'});
  assert.deepEqual(entryWindow({id: 'a', meta: {n_ctx: 131_072, n_ctx_train: 262_144}}, []), {window: 131_072, source: 'meta.n_ctx'});
  const data = [{id: 'base', max_model_len: 32_768}, {id: 'lora', parent: 'base', max_model_len: null}];
  assert.deepEqual(modelWindow({data}, 'lora'), {window: 32_768, source: 'max_model_len'});
  assert.deepEqual(modelWindow({data: [{id: 'x', aliases: ['m'], meta: {n_ctx: 4096}}, {id: 'y'}]}, 'm'), {window: 4096, source: 'meta.n_ctx'});
  assert.deepEqual(modelWindow({data: [{id: 'only', max_model_len: 8192}]}, 'other-name'), {window: 8192, source: 'max_model_len'});
  assert.equal(modelWindow({data: [{id: 'a'}, {id: 'b'}]}, 'm'), undefined);
  assert.deepEqual(healthWindow({max_context: 16_384}), {window: 16_384, source: 'health'});
  assert.equal(healthWindow({status: 'ok'}), undefined);
  assert.equal(entryWindow({id: 'a', max_model_len: -5, meta: {n_ctx: 1.5}}, []), undefined);
});

test('only loopback and private-network hosts are probed by default', () => {
  for (const h of ['127.0.0.1', 'localhost', '[::1]', '10.1.2.3', '192.168.0.9', '172.16.0.1', '172.31.255.1', '[fd12:3456::1]']) assert.ok(PRIVATE_HOST.test(h), h);
  for (const h of ['8.8.8.8', 'api.example.com', '172.32.0.1', '11.0.0.1', '[2001:db8::1]']) assert.ok(!PRIVATE_HOST.test(h), h);
});

test('applies a reported window, bumps the revision, follows changes and returns to configured', async () => {
  const e = await engine({'/v1/models': {data: [{id: 'm', max_model_len: 131_072}]}});
  const providers = route(`${e.url}/v1`);
  const dir = mkdtempSync(join(tmpdir(), 'engine-context-'));
  try {
    const src = createEngineContext({getProviders: () => providers, logger: quiet, logFile: join(dir, 'log.jsonl')});
    assert.equal(src.window('engine', 'm'), undefined);
    await src.probeAll('test');
    assert.equal(src.window('engine', 'm'), 131_072);
    assert.equal(src.revision, 1);
    await src.probeAll('test');
    assert.equal(src.revision, 1, 'an unchanged report does not bump the revision');
    e.replies['/v1/models'] = {data: [{id: 'm', max_model_len: 98_304}]};
    await src.probeAll('test');
    assert.equal(src.window('engine', 'm'), 98_304);
    assert.equal(src.revision, 2);
    e.replies['/v1/models'] = {data: [{id: 'm', max_model_len: 65_536}]};
    await src.probeAll('test');
    assert.equal(src.window('engine', 'm'), undefined, 'equal to configured: nothing overrides');
    assert.equal(src.revision, 3);
    const lines = readFileSync(join(dir, 'log.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(lines.map((l) => l.kind), ['observed', 'changed', 'changed', 'changed']);
    assert.ok(e.seen.every((r) => r.method === 'GET'));
  } finally { rmSync(dir, {recursive: true, force: true}); }
});

test('cap, observeOnly, and the /health fallback', async () => {
  const e = await engine({'/v1/models': {data: [{id: 'other'}, {id: 'other2'}]}, '/health': {max_context: 200_000}});
  const capped = createEngineContext({getProviders: () => route(`${e.url}/v1`), logger: quiet, config: {contextWindowMax: {engine: 100_000}}});
  await capped.probeAll('test');
  assert.equal(capped.window('engine', 'm'), 100_000);
  assert.equal(capped.status().routes.engine.models.m.reported, 200_000);
  const observed = createEngineContext({getProviders: () => route(`${e.url}/v1`), logger: quiet, config: {observeOnly: ['engine']}});
  await observed.probeAll('test');
  assert.equal(observed.window('engine', 'm'), undefined);
  assert.equal(observed.status().routes.engine.models.m.observeOnly, true);
  assert.equal(observed.revision, 0);
});

test('silent or unreachable engines keep the current value; public hosts are never contacted', async () => {
  const e = await engine({'/v1/models': {data: [{id: 'm'}]}});
  const src = createEngineContext({getProviders: () => route(`${e.url}/v1`), logger: quiet});
  await src.probeAll('test');
  assert.equal(src.window('engine', 'm'), undefined);
  assert.equal(src.status().routes.engine.models.m.effective, 65_536);

  let fetched = 0;
  const offsite = createEngineContext({
    getProviders: () => route('https://api.example.com/v1'),
    logger: quiet,
    fetch: async () => { fetched += 1; throw new Error('must not fetch'); },
  });
  await offsite.probeAll('test');
  assert.equal(fetched, 0);

  const down = createEngineContext({getProviders: () => route('http://127.0.0.1:9/v1'), logger: quiet, config: {timeoutMs: 500}});
  await down.probeAll('test');
  assert.equal(down.window('engine', 'm'), undefined);
  assert.match(down.status().routes.engine.error, /models:/);
});

test('sends the route credential from its apiKeyEnv and re-probes once after a length stop', async () => {
  const e = await engine({'/v1/models': {data: [{id: 'm', max_model_len: 32_768}]}});
  const src = createEngineContext({
    getProviders: () => route(`${e.url}/v1`, 65_536, {apiKeyEnv: 'TEST_ENGINE_KEY'}),
    logger: quiet,
    env: {TEST_ENGINE_KEY: 'k-123'},
  });
  await src.onLengthStop({provider: 'engine', model: 'm', reason: 'max-tokens', contextWindow: 65_536});
  assert.equal(src.window('engine', 'm'), 32_768);
  assert.equal(e.seen[0].auth, 'Bearer k-123');
  const before = e.seen.length;
  assert.equal(src.onLengthStop({provider: 'engine', model: 'm', reason: 'max-tokens', contextWindow: 32_768}), undefined, 'throttled');
  assert.equal(e.seen.length, before);
});
