import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {currentProfile, listProfiles, useProfile} from '../src/profile.mjs';
import {listRoles, setRole, testRole} from '../src/roles.mjs';
import {readRoles, readSettings} from '../src/settings.mjs';
import {applyFollowItem, createTranscript, lastAnswer, transcriptToMarkdown} from '../src/transcript.mjs';
import {atelierHome, installRoot} from '../src/paths.mjs';

const DEFAULTS = `# my comment survives
llm-pi-ai:
  catalogProviders: []
  providers:
    atelier-openai:
      displayName: Your OpenAI-compatible endpoint
      api: openai-completions
      baseURL: http://localhost:9/v1
      apiKeyEnv: ATELIER_API_KEY
      models:
        - id: local-model
          name: Your model
          contextWindow: 32768
agent-default-model:
  provider: atelier-openai
  model: local-model
agent-presets:
  default: vitruvius
`;
const home = () => { const dir = mkdtempSync(join(tmpdir(), 'atelier-cli-test-')); writeFileSync(join(dir, 'settings.yaml'), DEFAULTS); return dir; };

test('home resolution follows ATELIER_HOME, then installed layout, then the checkout', () => {
  assert.match(atelierHome({ATELIER_HOME: '/tmp/x'}, '/repo'), /tmp[\\/]x$/);
  assert.equal(installRoot({}, '/repo'), undefined);
  assert.match(atelierHome({}, '/repo'), /user-home$/);
});

test('roles list reads the brain from settings.yaml', async () => {
  const dir = home();
  const roles = await listRoles(dir, {});
  const brain = roles.find(r => r.id === 'brain');
  assert.equal(brain.set, true);
  assert.equal(brain.config.model, 'local-model');
  assert.equal(roles.find(r => r.id === 'embeddings').set, false);
});

test('roles set brain writes the atelier-brain route and keeps comments', async () => {
  const dir = home();
  await setRole(dir, 'brain', {url: 'http://127.0.0.1:8000/v1/', model: 'holo', keyEnv: 'MY_BRAIN_KEY', vision: true, context: 65536});
  const text = readFileSync(join(dir, 'settings.yaml'), 'utf8');
  assert.match(text, /# my comment survives/);
  const s = readSettings(dir);
  assert.deepEqual(s['agent-default-model'], {provider: 'atelier-brain', model: 'holo'});
  const route = s['llm-pi-ai'].providers['atelier-brain'];
  assert.equal(route.baseURL, 'http://127.0.0.1:8000/v1');
  assert.equal(route.apiKeyEnv, 'MY_BRAIN_KEY');
  assert.deepEqual(route.models[0].input, ['text', 'image']);
  assert.equal(route.models[0].contextWindow, 65536);
  assert.equal(s['llm-pi-ai'].providers['atelier-openai'].baseURL, 'http://localhost:9/v1', 'the original route stays');
  assert.equal((await listRoles(dir, {})).find(r => r.id === 'vision').coveredByBrain, true);
});

test('roles set for other roles writes roles.json; bad input is refused', async () => {
  const dir = home();
  await setRole(dir, 'embeddings', {url: 'http://localhost:41902/v1', model: 'embeddinggemma', keyEnv: 'EMB_KEY'});
  assert.deepEqual(readRoles(dir).roles.embeddings, {baseURL: 'http://localhost:41902/v1', model: 'embeddinggemma', preset: 'custom', source: 'cli', apiKeyEnv: 'EMB_KEY'});
  await assert.rejects(setRole(dir, 'brain', {url: 'localhost:8000', model: 'x'}), /http:\/\//);
  await assert.rejects(setRole(dir, 'brain', {url: 'http://x/v1'}), /needs --model/);
  await assert.rejects(setRole(dir, 'brain', {url: 'http://x/v1', model: 'm', keyEnv: 'sk-123 secret'}), /name of an environment variable/);
  await assert.rejects(setRole(dir, 'wizard', {url: 'http://x/v1', model: 'm'}), /Unknown role/);
});

test('roles test reports connected, wrong model, refused key and nothing listening', async () => {
  let chatStatus = 200;
  const chats = [];
  const server = createServer((req, res) => {
    if (req.headers.authorization === 'Bearer wrong') { res.writeHead(401); return res.end(); }
    if (req.method === 'POST' && req.url.endsWith('/chat/completions')) {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        chats.push(JSON.parse(body));
        res.writeHead(chatStatus, {'content-type': 'application/json'});
        res.end(JSON.stringify(chatStatus === 200 ? {choices: [{message: {role: 'assistant', content: 'OK'}, finish_reason: 'stop'}]}
          : {error: {message: 'No API key for provider'}}));
      });
      return;
    }
    res.writeHead(200, {'content-type': 'application/json'});
    res.end(JSON.stringify({data: [{id: 'holo'}]}));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  try {
    const dir = home();
    await setRole(dir, 'brain', {url: `http://127.0.0.1:${port}/v1`, model: 'holo', keyEnv: 'K'});
    const ok = await testRole(dir, 'brain', {env: {}});
    assert.equal(ok.state, 'connected');
    assert.match(ok.message, /Answers a test message with holo/);
    // The brain is only "connected" after one tiny chat message came back, not because /models answered.
    assert.equal(chats.length, 1);
    assert.equal(chats[0].model, 'holo');
    assert.ok(chats[0].max_tokens <= 16);
    chatStatus = 500;
    const listedOnly = await testRole(dir, 'brain', {env: {}});
    assert.equal(listedOnly.state, 'failing');
    assert.match(listedOnly.message, /HTTP 500 at \/chat\/completions\)\. The server said: No API key for provider/);
    chatStatus = 200;
    assert.equal((await testRole(dir, 'brain', {env: {K: 'wrong'}})).state, 'failing');
    await setRole(dir, 'brain', {url: `http://127.0.0.1:${port}/v1`, model: 'other'});
    assert.match((await testRole(dir, 'brain', {env: {}})).message, /does not serve "other"/);
    assert.equal((await testRole(dir, 'stt', {env: {}})).state, 'not-set');
    const closed = createServer(); await new Promise(r => closed.listen(0, '127.0.0.1', r));
    const closedPort = closed.address().port; await new Promise(r => closed.close(r));
    await setRole(dir, 'helper', {url: `http://127.0.0.1:${closedPort}/v1`, model: 'x'});
    assert.match((await testRole(dir, 'helper', {env: {}, timeoutMs: 3000})).message, /Nothing is listening/);
  } finally { server.close(); }
});

test('profile use switches presets, goes to cloud and back to your own model', async () => {
  const dir = home();
  assert.equal(currentProfile(readSettings(dir)), 'vitruvius');
  await useProfile(dir, 'vitruvius-zero');
  assert.equal(readSettings(dir)['agent-presets'].default, 'vitruvius-zero');
  assert.equal(listProfiles(dir).find(p => p.active).id, 'vitruvius-zero');
  await useProfile(dir, 'cloud');
  let s = readSettings(dir);
  assert.equal(currentProfile(s), 'cloud');
  assert.equal(s['agent-default-model'].provider, 'omniroute-cloud');
  assert.ok(s['llm-pi-ai'].providers['chatgpt-plan']);
  assert.ok(s['llm-pi-ai'].providers['atelier-openai'], 'your own route is kept');
  await useProfile(dir, 'vitruvius');
  s = readSettings(dir);
  assert.deepEqual(s['agent-default-model'], {provider: 'atelier-openai', model: 'local-model'});
  assert.equal(currentProfile(s), 'vitruvius');
  assert.match(readFileSync(join(dir, 'settings.yaml'), 'utf8'), /# my comment survives/);
});

test('transcript reducer: snapshot chunks, tools, answer and markdown export', () => {
  const t = createTranscript();
  applyFollowItem(t, {type: 'snapshot', cursor: 3, records: [
    {type: 'event', event: {type: 'user/message', seq: 1, data: {source: {kind: 'user'}, content: [{type: 'text', text: 'Plan a room'}]}}},
    {type: 'event', event: {type: 'user/message', seq: 2, data: {source: {kind: 'system'}, content: [{type: 'text', text: '<system-reminder>'}]}}},
    {type: 'chunks', event: {type: 'chunkrow/text-chunks', seq: 3, time: 0, data: {turn: 1, step: 1, index: 0, dt: [0, 5], texts: ['Hel', 'lo']}}},
  ], projections: {values: {title: 'Room', agentPreset: 'vitruvius'}}});
  assert.equal(t.items.length, 2);
  assert.equal(t.items[1].text, 'Hello');
  applyFollowItem(t, {type: 'event', event: {type: 'tool/call', seq: 4, data: {callId: 'c1', name: 'board_draw', arguments: '{"title":"Plan"}'}}});
  applyFollowItem(t, {type: 'event', event: {type: 'tool/result', seq: 5, data: {message: {content: [{type: 'tool-result', toolCallId: 'c1', content: [{type: 'text', text: 'saved'}]}]}}}});
  applyFollowItem(t, {type: 'event', event: {type: 'assistant/message', seq: 6, data: {turn: 1, step: 2, message: {content: [{type: 'text', text: '\n\nDone.'}]}, usage: {inputTokens: 10, outputTokens: 2}}}});
  applyFollowItem(t, {type: 'event', event: {type: 'turn/end', seq: 7, data: {turn: 1, reason: {kind: 'completed'}}}});
  assert.equal(t.items.find(i => i.kind === 'tool').result, 'saved');
  assert.equal(lastAnswer(t), 'Done.');
  assert.equal(t.title, 'Room');
  const md = transcriptToMarkdown(t, {id: 's1'});
  assert.match(md, /## You\n\nPlan a room/);
  assert.match(md, /`board_draw`/);
  assert.match(md, /ARCITECH/);
});
