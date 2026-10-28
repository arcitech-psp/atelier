import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {generateKeyPairSync, createHmac, randomBytes} from 'node:crypto';
import {FORMAT, atomicJson, canonical, compare, hash, portablePath, seal, validateManifest, verifyRelease, versionParts} from '../release.mjs';
import {createReleaseServer} from '../release-server.mjs';
import {publishRelease} from '../release-cli.mjs';
import {activatePending, channelState, channelStatus, checkChannel, configureChannel, rollbackChannel, stageChannel} from '../channel-client.mjs';
import {pollGithub} from '../github.mjs';
import {executeMirror, prepareMirror} from '../github-mirror.mjs';

function fixture(ch = 'public', version = '0.2.0') {
  const data = {'start-preview.mjs': `console.log('release ${version}');`, 'public/feature/index.mjs': 'export const ready = true;',
    'public/feature/client.js': 'window.fixture = true;', 'harness/presets/standard/agent.cordis.yml': '- id: fixture\n', 'harness/profiles/web.yml': '- id: web\n'};
  const kinds = ['application', 'module', 'client', 'preset', 'profile'];
  const m = {format: FORMAT, channel: ch, version, platform: 'any', createdAt: '2026-10-27T00:00:00Z', sourceRevision: 'fixture-only',
    defaultProfile: ch === 'dev' ? 'clippy' : 'standard', presets: ch === 'dev' ? ['standard', 'clippy'] : ['standard'], profiles: ['web'],
    features: {studioImages: true, studioVideo: ch === 'dev', ownerAssistant: ch === 'dev'}, entrypoint: 'start-preview.mjs',
    files: Object.entries(data).map(([path, value], i) => ({path, sha256: hash(value), size: Buffer.byteLength(value), kind: kinds[i]}))};
  return {manifest: m, data};
}
async function lab(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'atelier-releases-test-'));
  const dev = generateKeyPairSync('ed25519'), pub = generateKeyPairSync('ed25519');
  const keys = {dev: dev.publicKey, public: pub.publicKey}, privateKeys = {dev: dev.privateKey, public: pub.privateKey};
  const manager = randomBytes(32).toString('base64url'), reader = randomBytes(32).toString('base64url'), privateReader = randomBytes(32).toString('base64url');
  const authFile = join(root, 'auth.json');
  await atomicJson(authFile, {manager: {id: 'manager', digest: hash(manager)}, clients: {
    reader: {channels: ['public'], digest: hash(reader)}, colleague: {channels: ['dev'], digest: hash(privateReader)},
  }});
  const start = () => createReleaseServer({root: join(root, 'server'), authFile, keys, ...options});
  let service = await start();
  await new Promise(done => service.server.listen(0, '127.0.0.1', done));
  const url = `http://127.0.0.1:${service.server.address().port}`;
  t.after(async () => { await new Promise(done => service.server.close(done)); await rm(root, {recursive: true, force: true}); });
  const request = (path, token = manager, init = {}) => fetch(`${url}${path}`, {...init, headers: {...init.headers, authorization: `Bearer ${token}`}});
  async function publish(ch = 'public', version = '0.2.0', change = () => {}) {
    const f = fixture(ch, version); change(f);
    const directory = join(root, `upload-${ch}-${version}-${randomBytes(3).toString('hex')}`);
    await mkdir(join(directory, 'objects'), {recursive: true});
    for (const file of f.manifest.files.filter(f => !f.link)) await writeFile(join(directory, 'objects', file.sha256), f.data[file.path]);
    const envelope = seal(f.manifest, privateKeys[ch]);
    await atomicJson(join(directory, 'manifest.json'), envelope);
    const result = await publishRelease({directory, url, token: manager});
    return {...f, envelope, directory, result};
  }
  const client = (ch = 'public', name = ch) => ({url, root: join(root, `client-${name}`), channel: ch, token: ch === 'dev' ? privateReader : reader,
    publicKey: keys[ch], intervalMs: 30000, platform: process.platform === 'win32' ? 'windows' : 'linux'});
  return {root, manager, reader, privateReader, request, publish, client, service, keys, privateKeys, authFile};
}

test('semantic versions order prereleases numerically and reject ambiguous identifiers', () => {
  assert(compare('1.10.0', '1.9.9') > 0); assert(compare('1.0.0-dev.10', '1.0.0-dev.2') > 0);
  assert(compare('1.0.0', '1.0.0-rc.2') > 0); assert(compare('1.0.0-2', '1.0.0-a') < 0);
  for (const v of ['v1.0.0', '1.00.0', '1.0.0-01', '../1.0.0', '1.0', '1.0.0+unsafe']) assert.throws(() => versionParts(v));
});
test('portable paths reject traversal, Windows devices, streams and separators', () => {
  for (const p of ['../escape', 'a/../../b', 'C:/x', '/etc/x', 'a\\b', 'CON.txt', 'a/NUL', 'a:x', 'a//b', 'a./b', 'a /b']) assert.throws(() => portablePath(p));
  assert.equal(portablePath('public/package/client.js'), 'public/package/client.js');
});
test('signatures bind channel, manifest content and signing key', () => {
  const a = generateKeyPairSync('ed25519'), b = generateKeyPairSync('ed25519'), m = fixture().manifest, signed = seal(m, a.privateKey);
  assert.equal(verifyRelease(signed, a.publicKey, 'public').version, '0.2.0');
  assert.throws(() => verifyRelease(signed, b.publicKey, 'public'));
  assert.throws(() => verifyRelease(signed, a.publicKey, 'dev'));
  signed.manifest.sourceRevision = 'tampered'; assert.throws(() => verifyRelease(signed, a.publicKey, 'public'));
});
test('public policy denies private profiles, features, markers and user-state files', () => {
  const base = fixture().manifest;
  const cases = [m => m.presets.push('clippy'), m => { m.features.studioVideo = true; }, m => { m.defaultProfile = 'absent'; },
    m => { m.sourceRevision = ['10.0.0', '.9'].join(''); }, m => { m.files[0].path = 'settings.yaml'; }, m => { m.files[0].path = 'sessions/chat.json'; }];
  for (const mutate of cases) { const m = structuredClone(base); mutate(m); assert.throws(() => validateManifest(m)); }
});
test('inventory rejects duplicate paths, case collisions, parent files and missing entrypoint', () => {
  const m = fixture().manifest;
  m.files.push({...m.files[0], path: m.files[0].path.toUpperCase()}); assert.throws(() => validateManifest(m));
  m.files.pop(); m.files.push({...m.files[0], path: 'public'}); assert.throws(() => validateManifest(m));
  m.files.pop(); m.entrypoint = 'missing.mjs'; assert.throws(() => validateManifest(m));
});
test('channel readers cannot publish, cross channels, or read quarantined objects', async t => {
  const l = await lab(t); await l.publish(); await l.publish('dev');
  assert.equal((await l.request('/v1/channels/dev/latest', l.reader)).status, 403);
  assert.equal((await l.request('/v1/channels/public/latest', l.privateReader)).status, 403);
  assert.equal((await l.request('/v1/channels/public/releases', l.reader, {method: 'POST', body: '{}'})).status, 403);
  assert.equal((await l.request(`/v1/channels/public/objects/${'0'.repeat(64)}`, l.reader)).status, 404);
  assert.equal((await fetch(`${l.client().url}/v1/channels/public/latest`)).status, 401);
});
test('manager publication is immutable and forward-only per channel', async t => {
  const l = await lab(t); const first = await l.publish();
  assert.equal(first.result.sequence, 1);
  await assert.rejects(() => l.publish()); await assert.rejects(() => l.publish('public', '0.1.9'));
  await l.publish('public', '0.2.1');
  const history = await (await l.request('/v1/channels/public/history', l.reader)).json();
  assert.deepEqual(history.releases.map(r => r.version), ['0.2.0', '0.2.1']);
});
test('invitations are scoped, digest-only on disk and revocable', async t => {
  const l = await lab(t); await l.publish('dev');
  const response = await l.request('/v1/manager/invitations', l.manager, {method: 'POST', body: JSON.stringify({id: 'new-client', channels: ['dev']})});
  assert.equal(response.status, 201); const invite = await response.json();
  assert.equal((await l.request('/v1/channels/dev/latest', invite.token)).status, 200);
  assert(!(await readFile(l.authFile, 'utf8')).includes(invite.token));
  assert.equal((await l.request('/v1/manager/invitations/new-client', l.manager, {method: 'DELETE'})).status, 200);
  assert.equal((await l.request('/v1/channels/dev/latest', invite.token)).status, 403);
});
test('wrong object checksums and incomplete inventories never commit a release', async t => {
  const l = await lab(t);
  assert.equal((await l.request(`/v1/channels/public/objects/${'0'.repeat(64)}`, l.manager, {method: 'PUT', body: 'bad'})).status, 422);
  const envelope = seal(fixture().manifest, l.privateKeys.public);
  assert.equal((await l.request('/v1/channels/public/releases', l.manager, {method: 'POST', body: JSON.stringify(envelope)})).status, 409);
  assert.equal((await l.request('/v1/channels/public/latest', l.reader)).status, 404);
});
test('publish scans public artifact contents as well as metadata', async t => {
  const l = await lab(t);
  await assert.rejects(() => l.publish('public', '0.2.0', f => {
    const file = f.manifest.files[1]; f.data[file.path] = ['10.0.0', '.9'].join('');
    file.size = Buffer.byteLength(f.data[file.path]); file.sha256 = hash(f.data[file.path]);
  }));
});
test('client verifies, stages, activates on demand and keeps user state outside releases', async t => {
  const l = await lab(t); await l.publish(); const c = l.client();
  await mkdir(c.root, {recursive: true}); await writeFile(join(c.root, 'owner-chat.json'), 'keep');
  assert.equal((await checkChannel(c)).latest, '0.2.0');
  assert.equal((await stageChannel(c)).pending, '0.2.0'); assert.equal((await channelStatus(c)).current, null);
  assert.equal((await activatePending(c)).current, '0.2.0');
  assert.equal(await readFile(join(c.root, 'owner-chat.json'), 'utf8'), 'keep');
  assert((await readFile(join(c.root, 'versions/0.2.0/app/start-preview.mjs'), 'utf8')).includes('0.2.0'));
});
test('manager push becomes a new client version and rollback survives subsequent checks', async t => {
  const l = await lab(t), c = l.client(); await l.publish(); await checkChannel(c); await stageChannel(c); await activatePending(c);
  await l.publish('public', '0.2.1'); assert.equal((await checkChannel(c)).changed, true);
  await stageChannel(c); const second = await activatePending(c); assert.equal(second.previous, '0.2.0');
  await rollbackChannel(c); await activatePending(c); assert.equal((await channelStatus(c)).current, '0.2.0');
  await checkChannel(c); await assert.rejects(() => stageChannel(c), /rolled back/);
});
test('tampered downloads leave current and pending unchanged and clean temporary staging', async t => {
  const l = await lab(t), c = l.client(); await l.publish(); await checkChannel(c);
  c.fetchImpl = async (url, init) => url.includes('/objects/') ? new Response('wrong') : fetch(url, init);
  await assert.rejects(() => stageChannel(c));
  assert.equal((await channelStatus(c)).current, null); assert.equal((await channelStatus(c)).pending, null);
  const {readdir} = await import('node:fs/promises');
  assert(!(await readdir(join(c.root, 'versions'))).some(name => name.endsWith('.partial')));
});
test('activation rechecks bytes and rejects local corruption', async t => {
  const l = await lab(t), c = l.client(); await l.publish(); await checkChannel(c); await stageChannel(c);
  await writeFile(join(c.root, 'versions/0.2.0/app/start-preview.mjs'), 'bad');
  await assert.rejects(() => activatePending(c)); assert.equal((await channelStatus(c)).current, null);
});
test('client rejects wrong pinned key and root reuse across channels', async t => {
  const l = await lab(t), c = l.client(); await l.publish(); c.publicKey = l.keys.dev;
  await assert.rejects(() => checkChannel(c)); c.publicKey = l.keys.public; await checkChannel(c);
  await assert.rejects(() => channelState({...c, channel: 'dev'}), /another channel/);
});
test('ETag check is conditional and concurrent writers are rejected', async t => {
  const l = await lab(t), c = l.client(); await l.publish(); await checkChannel(c);
  assert.equal((await checkChannel(c)).changed, false);
  const results = await Promise.allSettled([checkChannel(c), stageChannel(c)]);
  assert.equal(results.filter(r => r.status === 'rejected').length, 1);
});
test('server history and revision persist across process instance recreation', async t => {
  const l = await lab(t); await l.publish();
  const next = await createReleaseServer({root: join(l.root, 'server'), authFile: l.authFile, keys: l.keys});
  assert.equal((await next.state('public')).sequence, 1); assert.equal((await next.state('public')).current, '0.2.0');
  next.server.close();
});
test('webhook rejects bad signatures and only accepts matching channel/repository/tag', async t => {
  const secret = randomBytes(32).toString('hex');
  const l = await lab(t, {webhookSecret: secret, github: {dev: {repo: 'example/private'}}});
  const payload = JSON.stringify({action: 'published', repository: {full_name: 'example/private', private: true}, release: {tag_name: 'dev/v0.2.1', draft: false}});
  const send = signature => l.request('/v1/github/webhook', l.reader, {method: 'POST', headers: {'x-github-event': 'release', 'x-hub-signature-256': signature}, body: payload});
  assert.equal((await send('sha256=bad')).status, 401);
  const signature = `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`;
  assert.equal((await send(signature)).status, 202); assert.equal((await l.service.state('dev')).hint, 1);
  await send(signature); assert.equal((await l.service.state('dev')).hint, 1);
});
test('GitHub polling validates private visibility and only records a hint', async () => {
  const hints = [], service = {hint: async (...args) => { hints.push(args); return true; }};
  const fetchImpl = async url => new Response(JSON.stringify(url.includes('/releases?') ? [{tag_name: 'dev/v0.2.0', draft: false}]
    : {full_name: 'example/private', private: true}), {status: 200});
  await pollGithub(service, {dev: {repo: 'example/private', tokenEnv: 'TEST'}}, {fetchImpl, env: {TEST: 'ephemeral'}});
  assert.deepEqual(hints, [['dev', 'dev/v0.2.0']]);
  await assert.rejects(() => pollGithub(service, {public: {repo: 'example/private'}}, {fetchImpl, env: {}}), /visibility/);
});
test('GitHub mirror is prepared offline; wrong visibility prevents every push', async t => {
  const l = await lab(t), release = await l.publish();
  const plan = await prepareMirror({directory: release.directory, repo: 'example/public', publicKey: l.keys.public, output: l.root});
  assert.equal(plan.tag, 'public/v0.2.0');
  const commands = [];
  const runImpl = async (cmd, args) => { commands.push([cmd, args]); return JSON.stringify({visibility: 'PRIVATE', nameWithOwner: 'example/public'}); };
  await assert.rejects(() => executeMirror(plan, {pushSource: 'review', runImpl}), /visibility/);
  assert.equal(commands.length, 1); assert.equal(commands[0][0], 'gh');
});
