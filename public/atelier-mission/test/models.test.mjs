import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {test} from 'node:test';
import {
  applyWaiting, buildStatus, collectRoles, inferLoading, originOf, parseLlamaSwapRunning, parseLmStudioV0, parseLmStudioV1, parseOllamaPs,
  probeServer, sameModel, stateOf,
} from '../models.mjs';

// ---- fake provider answers (shapes taken from each tool's documentation) --------------------------------------------

const LM_STUDIO_V0 = {object: 'list', data: [
  {id: 'qwen3-14b', object: 'model', type: 'llm', publisher: 'qwen', arch: 'qwen3', state: 'loaded', max_context_length: 40960, loaded_context_length: 16384},
  {id: 'qwen2.5-vl-7b-instruct', object: 'model', type: 'vlm', state: 'not-loaded', max_context_length: 32768},
  {id: 'text-embedding-nomic-embed-text-v1.5', object: 'model', type: 'embeddings', state: 'not-loaded', max_context_length: 2048},
]};
const LM_STUDIO_V1 = {models: [
  {type: 'llm', publisher: 'qwen', key: 'qwen/qwen3-14b', display_name: 'Qwen3 14B', size_bytes: 9_000_000_000, loaded_instances: [{id: 'qwen/qwen3-14b', config: {context_length: 16384}}]},
  {type: 'embedding', publisher: 'nomic-ai', key: 'text-embedding-nomic-embed-text-v1.5', display_name: 'Nomic Embed', size_bytes: 84_000_000, loaded_instances: []},
]};
const OLLAMA_PS = {models: [{
  name: 'qwen3:14b', model: 'qwen3:14b', size: 11_000_000_000, digest: 'abc', details: {family: 'qwen3'},
  expires_at: new Date(Date.now() + 240_000).toISOString(), size_vram: 10_500_000_000,
}]};
const LLAMA_SWAP_RUNNING = {running: [
  {model: 'brain', state: 'ready', cmd: 'llama-server -m brain.gguf', proxy: 'http://127.0.0.1:5800', ttl: 300, name: 'Brain', description: ''},
  {model: 'vision', state: 'starting', cmd: 'llama-server -m vl.gguf', proxy: 'http://127.0.0.1:5801', ttl: 0, name: '', description: ''},
  {model: 'old', state: 'stopping', cmd: '', proxy: '', ttl: 0, name: '', description: ''},
]};

test('LM Studio v0: loaded and not-loaded', () => {
  const parsed = parseLmStudioV0(LM_STUDIO_V0);
  assert.equal(parsed.provider, 'lmstudio');
  assert.deepEqual(parsed.models.map(model => [model.id, model.state]), [['qwen3-14b', 'loaded'], ['qwen2.5-vl-7b-instruct', 'unloaded'], ['text-embedding-nomic-embed-text-v1.5', 'unloaded']]);
  assert.equal(parsed.models[0].contextLength, 16384);
  assert.equal(parsed.models[1].kind, 'vlm');
});

test('LM Studio v1: a model with loaded instances is loaded', () => {
  const parsed = parseLmStudioV1(LM_STUDIO_V1);
  assert.deepEqual(parsed.models.map(model => [model.id, model.state]), [['qwen/qwen3-14b', 'loaded'], ['text-embedding-nomic-embed-text-v1.5', 'unloaded']]);
  assert.equal(parsed.models[0].sizeBytes, 9_000_000_000);
});

test('Ollama /api/ps: listed means in memory, with the keep_alive deadline and VRAM share', () => {
  const parsed = parseOllamaPs(OLLAMA_PS);
  assert.equal(parsed.provider, 'ollama');
  assert.equal(parsed.models.length, 1);
  assert.equal(parsed.models[0].state, 'loaded');
  assert.equal(parsed.models[0].vramBytes, 10_500_000_000);
  assert.ok(parsed.models[0].expiresAt > Date.now());
  // idle Ollama still answers, with nothing loaded
  assert.deepEqual(parseOllamaPs({models: []}), {provider: 'ollama', models: []});
});

test('Ollama: "never unload" dates are not shown as a countdown', () => {
  const forever = {models: [{name: 'm', model: 'm', size: 1, digest: 'd', expires_at: '2318-01-01T00:00:00Z', size_vram: 1}]};
  assert.equal(parseOllamaPs(forever).models[0].expiresAt, undefined);
  const zero = {models: [{name: 'm', model: 'm', size: 1, digest: 'd', expires_at: '0001-01-01T00:00:00Z', size_vram: 1}]};
  assert.equal(parseOllamaPs(zero).models[0].expiresAt, undefined);
});

test('llama-swap /running: ready, starting, stopping; absent means unloaded', () => {
  const parsed = parseLlamaSwapRunning(LLAMA_SWAP_RUNNING);
  assert.equal(parsed.provider, 'llama-swap');
  assert.deepEqual(parsed.models.map(model => [model.id, model.state]), [['brain', 'loaded'], ['vision', 'loading'], ['old', 'unloading']]);
  assert.equal(parsed.models[0].ttlSeconds, 300);
  assert.equal(parsed.models[1].ttlSeconds, undefined);
  assert.equal(stateOf(parsed, 'embeddings').state, 'unloaded');
  assert.deepEqual(parseLlamaSwapRunning({running: []}), {provider: 'llama-swap', models: []});
  assert.equal(parseLlamaSwapRunning({running: [{model: 'x', state: 'weird'}]}).models[0].state, 'unknown');
});

test('parsers refuse bodies that are not theirs', () => {
  for (const parse of [parseLmStudioV0, parseLmStudioV1, parseOllamaPs, parseLlamaSwapRunning]) {
    assert.equal(parse(null), null);
    assert.equal(parse('text'), null);
    assert.equal(parse([]), null);
    assert.equal(parse({}), null);
    assert.equal(parse({data: 5, models: 5, running: 5}), null);
  }
  // an OpenAI-style model list is not LM Studio's: it has no state field
  assert.equal(parseLmStudioV0({object: 'list', data: [{id: 'gpt-x', object: 'model'}]}), null);
  assert.equal(parseOllamaPs({models: [{foo: 1}]}), null);
});

test('model ids are compared the way the servers name them', () => {
  assert.ok(sameModel('qwen3:14b', 'Qwen3:14B'));
  assert.ok(sameModel('llama3.2:latest', 'llama3.2'));
  assert.ok(sameModel('qwen/qwen3-14b', 'qwen3-14b'));
  assert.ok(!sameModel('qwen3:14b', 'qwen3:8b'));
  assert.ok(!sameModel('', ''));
  assert.ok(!sameModel(undefined, 'x'));
});

test('state of a configured model on a server', () => {
  const lm = parseLmStudioV0(LM_STUDIO_V0);
  assert.equal(stateOf(lm, 'qwen3-14b').state, 'loaded');
  assert.equal(stateOf(lm, 'qwen2.5-vl-7b-instruct').state, 'unloaded');
  assert.equal(stateOf(null, 'anything').state, 'offline');
  assert.equal(stateOf({provider: 'other', models: []}, 'anything').state, 'unknown');
  const ollama = parseOllamaPs(OLLAMA_PS);
  assert.equal(stateOf(ollama, 'qwen3:14b').state, 'loaded');
  assert.equal(stateOf(ollama, 'nomic-embed-text').state, 'unloaded');
  // two instances of one model: the loaded one decides
  const twice = {provider: 'lmstudio', models: [{id: 'm', state: 'unloaded'}, {id: 'm:2', name: 'm', state: 'loaded'}]};
  assert.equal(stateOf(twice, 'm').state, 'loaded');
});

test('a request waiting for its first token on an unloaded model is shown as loading', () => {
  assert.equal(inferLoading('unloaded', 2000), 'loading');
  assert.equal(inferLoading('unloaded', 500), 'unloaded');
  assert.equal(inferLoading('loaded', 60_000), 'loaded');
  assert.equal(inferLoading('offline', 60_000), 'offline');
  const roles = [{role: 'brain', label: 'Main model', model: 'qwen3-14b', origin: 'http://localhost:1234'}, {role: 'vision', label: 'Vision', model: 'qwen2.5-vl-7b-instruct', origin: 'http://localhost:1234'}];
  const base = buildStatus(roles, new Map([['http://localhost:1234', {origin: 'http://localhost:1234', provider: 'lmstudio', ok: true, models: [
    {id: 'qwen3-14b', state: 'unloaded'}, {id: 'qwen2.5-vl-7b-instruct', state: 'unloaded'}]}]]));
  assert.equal(base.summary.state, 'unloaded');
  const waiting = applyWaiting(base, 12_000);
  assert.equal(waiting.summary.state, 'loading');
  assert.equal(waiting.summary.inferred, true);
  assert.equal(waiting.rows.find(row => row.role === 'vision').state, 'unloaded');   // only the main model is waited on
  assert.equal(applyWaiting(base, 0), base);
});

// ---- roles from settings --------------------------------------------------------------------------------------------

test('roles come from the default model, the helper route and the saved role endpoints', () => {
  const providers = {
    'atelier-brain': {baseURL: 'http://localhost:1234/v1', apiKeyEnv: 'ATELIER_ROLE_BRAIN_KEY', models: [{id: 'qwen3-14b'}]},
    'atelier-helper': {baseURL: 'http://localhost:1234/v1/', models: [{id: 'qwen3-1.7b'}]},
    'atelier-openai': {baseURL: 'https://YOUR_OPENAI_COMPATIBLE_HOST/v1', models: [{id: 'YOUR_MODEL_ID'}]},
  };
  const roles = collectRoles({
    providers, selection: {provider: 'atelier-brain', model: 'qwen3-14b'},
    roles: {vision: {baseURL: 'http://localhost:1234/v1', model: 'qwen2.5-vl-7b-instruct'}, embeddings: {baseURL: 'http://localhost:11434/v1', model: 'nomic-embed-text'}, image: {baseURL: 'not a url', model: 'x'}},
  });
  assert.deepEqual(roles.map(role => [role.role, role.model, role.origin]), [
    ['brain', 'qwen3-14b', 'http://localhost:1234'], ['helper', 'qwen3-1.7b', 'http://localhost:1234'],
    ['vision', 'qwen2.5-vl-7b-instruct', 'http://localhost:1234'], ['embeddings', 'nomic-embed-text', 'http://localhost:11434']]);
  assert.equal(roles[0].apiKeyEnv, 'ATELIER_ROLE_BRAIN_KEY');
  // the unset placeholder endpoint is not a model
  assert.deepEqual(collectRoles({providers, selection: {provider: 'atelier-openai', model: 'YOUR_MODEL_ID'}}).map(role => role.role), ['helper']);
  assert.deepEqual(collectRoles({}), []);
});

test('origin of a base URL', () => {
  assert.equal(originOf('http://localhost:1234/v1'), 'http://localhost:1234');
  assert.equal(originOf('https://example.com/openai/v1/'), 'https://example.com');
  assert.equal(originOf('ftp://x'), undefined);
  assert.equal(originOf('nonsense'), undefined);
});

// ---- real HTTP round trips against fake servers ---------------------------------------------------------------------

async function fakeServer(routes) {
  const server = createServer((request, response) => {
    const route = routes[request.url.split('?')[0]];
    if (!route) { response.statusCode = 404; response.end('{}'); return; }
    response.setHeader('content-type', 'application/json');
    response.end(typeof route === 'string' ? route : JSON.stringify(route));
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  return {origin: `http://127.0.0.1:${server.address().port}`, close: () => { server.closeAllConnections?.(); return new Promise(done => server.close(done)); }};
}

test('probe: finds LM Studio, Ollama and llama-swap by the shape of their own answers', async () => {
  const lm = await fakeServer({'/api/v0/models': LM_STUDIO_V0, '/v1/models': {object: 'list', data: []}});
  const ollama = await fakeServer({'/api/ps': OLLAMA_PS, '/api/tags': {models: []}});
  const swap = await fakeServer({'/running': LLAMA_SWAP_RUNNING, '/v1/models': {object: 'list', data: []}});
  try {
    const a = await probeServer(lm.origin), b = await probeServer(ollama.origin), c = await probeServer(swap.origin);
    assert.deepEqual([a.provider, a.ok], ['lmstudio', true]);
    assert.deepEqual([b.provider, b.ok], ['ollama', true]);
    assert.deepEqual([c.provider, c.ok], ['llama-swap', true]);
    const status = buildStatus(
      [{role: 'brain', label: 'Main model', model: 'brain', origin: swap.origin}, {role: 'vision', label: 'Vision', model: 'vision', origin: swap.origin},
        {role: 'embeddings', label: 'Embeddings', model: 'embed', origin: swap.origin}],
      new Map([[swap.origin, c]]));
    assert.deepEqual(status.rows.map(row => [row.role, row.state]), [['brain', 'loaded'], ['vision', 'loading'], ['embeddings', 'unloaded']]);
    assert.equal(status.rows[0].providerName, 'llama-swap');
    assert.equal(status.summary.state, 'loaded');
    assert.deepEqual(status.servers[0].loaded.map(model => model.id), ['brain', 'vision']);
  } finally { await Promise.all([lm.close(), ollama.close(), swap.close()]); }
});

test('probe: an LM Studio that only has the v1 endpoint is still recognised', async () => {
  const lm = await fakeServer({'/api/v1/models': LM_STUDIO_V1});
  try {
    const result = await probeServer(lm.origin);
    assert.equal(result.provider, 'lmstudio');
    assert.equal(stateOf(result, 'qwen3-14b').state, 'loaded');
  } finally { await lm.close(); }
});

test('probe: a server that is none of the three is reachable but not tracked', async () => {
  const plain = await fakeServer({'/v1/models': {object: 'list', data: [{id: 'm', object: 'model'}]}});
  try {
    const result = await probeServer(plain.origin, {apiBase: `${plain.origin}/v1`});
    assert.deepEqual([result.provider, result.ok], ['other', true]);
    assert.equal(stateOf(result, 'm').state, 'unknown');
  } finally { await plain.close(); }
});

test('probe: nothing listening is offline, with a plain-words reason', async () => {
  const gone = await fakeServer({});
  const origin = gone.origin;
  await gone.close();
  const result = await probeServer(origin, {timeoutMs: 500});
  assert.equal(result.ok, false);
  assert.match(result.error, /Nothing is listening|No answer|Connection failed/);
  const status = buildStatus([{role: 'brain', label: 'Main model', model: 'm', origin}], new Map([[origin, result]]));
  assert.equal(status.rows[0].state, 'offline');
  assert.ok(status.rows[0].error);
});

test('probe: sends the API key as a bearer token when given', async () => {
  let seen;
  const server = createServer((request, response) => { seen = request.headers.authorization; response.setHeader('content-type', 'application/json'); response.end(JSON.stringify(LLAMA_SWAP_RUNNING)); });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  try {
    await probeServer(`http://127.0.0.1:${server.address().port}`, {headers: {authorization: 'Bearer secret-key'}});
    assert.equal(seen, 'Bearer secret-key');
  } finally { server.closeAllConnections?.(); await new Promise(done => server.close(done)); }
});
