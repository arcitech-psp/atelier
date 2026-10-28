// Small authenticated release service; no inference, package manager, or subprocesses.
import {createServer} from 'node:http';
import {createReadStream, createWriteStream} from 'node:fs';
import {access, mkdir, readFile, rename, rm, stat} from 'node:fs/promises';
import {createHash, createHmac, randomBytes, timingSafeEqual} from 'node:crypto';
import {join} from 'node:path';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {atomicJson, assertPublicText, canonical, channel, compare, hash, readJson, verifyRelease, versionParts} from './release.mjs';

const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
async function body(req, limit = 24 * 1024 ** 2) {
  let count = 0; const parts = [];
  for await (const chunk of req) {
    count += chunk.length;
    if (count > limit) throw new HttpError(413, 'Request is too large.');
    parts.push(chunk);
  }
  return Buffer.concat(parts);
}
function json(res, status, value, headers = {}) {
  const data = JSON.stringify(value);
  res.writeHead(status, {'content-type': 'application/json', 'content-length': Buffer.byteLength(data), 'cache-control': 'no-store', ...headers});
  res.end(data);
}
export async function createReleaseServer({root, authFile, keys, github = {}, webhookSecret, maxObjectBytes = 1024 ** 3}) {
  if (!root || !authFile || !keys?.dev || !keys?.public) throw Error('Release root, auth database and channel public keys are required.');
  for (const ch of ['dev', 'public']) {
    await mkdir(join(root, ch, 'objects'), {recursive: true});
    await mkdir(join(root, ch, 'releases'), {recursive: true});
  }
  let tail = Promise.resolve();
  const exclusive = operation => {
    const run = tail.then(operation);
    tail = run.catch(() => {});
    return run;
  };
  const stateFile = ch => join(root, ch, 'history.json');
  const state = ch => readJson(stateFile(ch), {sequence: 0, current: null, releases: [], hint: 0, githubTag: null});
  const objectFile = (ch, digest) => join(root, ch, 'objects', digest);
  const publishedObjects = new Map();
  async function objectListed(ch, digest) {
    const history = await state(ch), cached = publishedObjects.get(ch);
    if (cached?.sequence === history.sequence) return cached.digests.has(digest);
    const digests = new Set();
    for (const release of history.releases) {
      const envelope = await readJson(join(root, ch, release.version, 'manifest.json'));
      for (const f of envelope.manifest.files) if (!f.link) digests.add(f.sha256);
    }
    publishedObjects.set(ch, {sequence: history.sequence, digests});
    return digests.has(digest);
  }
  async function authorize(req, ch, manager = false) {
    const token = /^Bearer ([^\s]+)$/.exec(req.headers.authorization ?? '')?.[1];
    const db = await readJson(authFile);
    if (!token || token.length > 512) throw new HttpError(401, 'Channel authentication required.');
    const digest = hash(token);
    if (equal(digest, db.manager?.digest)) return {manager: true, id: db.manager.id};
    if (manager) throw new HttpError(403, 'Only the manager can publish or manage invitations.');
    if (Object.values(db.clients ?? {}).some(client => !client.revoked && client.channels?.includes(ch) && equal(client.digest, digest))) return {manager: false};
    throw new HttpError(403, 'This invitation cannot read this channel.');
  }
  async function inspectObjects(m) {
    for (const file of m.files) {
      if (file.link) continue;
      const stored = objectFile(m.channel, file.sha256);
      const info = await stat(stored).catch(() => null);
      if (!info?.isFile() || info.size !== file.size) throw new HttpError(409, 'Upload all release objects before publishing.');
      const digest = createHash('sha256');
      const scan = m.channel === 'public' && file.kind !== 'dependency';
      let trailing = '';
      for await (const chunk of createReadStream(stored)) {
        digest.update(chunk);
        if (scan) { const text = trailing + chunk.toString('latin1'); assertPublicText(text); trailing = text.slice(-256); }
      }
      if (digest.digest('hex') !== file.sha256) throw new HttpError(409, 'Stored artifact checksum mismatch.');
    }
  }
  async function publish(envelope) {
    const m = verifyRelease(envelope, keys[channel(envelope?.manifest?.channel)], envelope.manifest.channel);
    await inspectObjects(m);
    return exclusive(async () => {
      const ch = m.channel, old = await state(ch), release = join(root, ch, m.version);
      if (old.releases.some(r => r.version === m.version) || await access(join(release, 'manifest.json')).then(() => true, () => false)) throw new HttpError(409, 'Release versions are immutable.');
      if (old.current && compare(m.version, old.current) <= 0) throw new HttpError(409, 'Publish a newer channel version.');
      await mkdir(release, {recursive: false});
      await atomicJson(join(release, 'manifest.json'), envelope);
      // History is the commit record: clients never observe an uncommitted release directory.
      const item = {version: m.version, sha256: hash(canonical(m)), publishedAt: new Date().toISOString()};
      const next = {...old, sequence: old.sequence + 1, current: m.version, releases: [...old.releases, item]};
      await atomicJson(stateFile(ch), next);
      return {version: m.version, channel: ch, sequence: next.sequence};
    });
  }
  async function hint(ch, tag) {
    return exclusive(async () => {
      const old = await state(ch);
      if (old.githubTag === tag) return false;
      await atomicJson(stateFile(ch), {...old, hint: old.hint + 1, githubTag: tag});
      return true;
    });
  }
  async function webhook(req, res) {
    if (!webhookSecret) throw new HttpError(404, 'Webhook is not configured.');
    const raw = await body(req, 1024 ** 2);
    const expected = `sha256=${createHmac('sha256', webhookSecret).update(raw).digest('hex')}`;
    if (!equal(expected, req.headers['x-hub-signature-256'])) throw new HttpError(401, 'Webhook signature rejected.');
    const value = JSON.parse(raw);
    if (req.headers['x-github-event'] === 'ping') return json(res, 200, {ok: true});
    if (req.headers['x-github-event'] !== 'release' || value.action !== 'published' || value.release?.draft) return json(res, 202, {ignored: true});
    const ch = Object.keys(github).find(ch => github[ch].repo === value.repository?.full_name);
    if (!ch || (ch === 'dev' && value.repository?.private !== true) || (ch === 'public' && value.repository?.private !== false)) throw new HttpError(403, 'Repository policy rejected.');
    const prefix = `${ch}/v`, tag = value.release.tag_name;
    if (typeof tag !== 'string' || !tag.startsWith(prefix)) throw new HttpError(400, 'Tag is outside this channel.');
    versionParts(tag.slice(prefix.length));
    json(res, 202, {ok: true, changed: await hint(ch, tag)});
  }
  const server = createServer(async (req, res) => {
    res.setHeader('x-content-type-options', 'nosniff');
    try {
      if (req.url === '/health' && req.method === 'GET') return json(res, 200, {ok: true, service: 'atelier-releases'});
      if (req.url === '/v1/github/webhook' && req.method === 'POST') return await webhook(req, res);
      const match = /^\/v1\/channels\/(dev|public)\/(latest|history|objects\/([a-f0-9]{64})|releases(?:\/([^/]+))?)$/.exec(req.url ?? '');
      if (match) {
        const [, ch, action, digest, version] = match;
        await authorize(req, ch, req.method !== 'GET' && req.method !== 'HEAD');
        if ((req.method === 'GET' || req.method === 'HEAD') && action.startsWith('objects/')) {
          // Objects are readable only when a committed release references them.
          if (!await objectListed(ch, digest)) throw new HttpError(404, 'Artifact is not in a published release.');
          const info = await stat(objectFile(ch, digest));
          res.writeHead(200, {'content-type': 'application/octet-stream', 'content-length': info.size, etag: `"${digest}"`, 'cache-control': 'private, immutable'});
          if (req.method === 'HEAD') return res.end();
          await pipeline(createReadStream(objectFile(ch, digest)), res); return;
        }
        if (req.method === 'PUT' && action.startsWith('objects/')) {
          const target = objectFile(ch, digest), temp = `${target}.${randomBytes(8).toString('hex')}.upload`;
          let bytes = 0; const sha = createHash('sha256');
          const counter = new Transform({transform(chunk, _, done) {
            bytes += chunk.length;
            if (bytes > maxObjectBytes) return done(new HttpError(413, 'Artifact is too large.'));
            sha.update(chunk); done(null, chunk);
          }});
          try {
            await pipeline(req, counter, createWriteStream(temp, {flags: 'wx', mode: 0o600}));
            if (sha.digest('hex') !== digest) throw new HttpError(422, 'Artifact checksum mismatch.');
            await rename(temp, target);
          } finally { await rm(temp, {force: true}); }
          return json(res, 201, {sha256: digest, size: bytes});
        }
        if (req.method === 'POST' && action === 'releases') return json(res, 201, await publish(JSON.parse(await body(req))));
        if (req.method === 'GET' && action === 'history') return json(res, 200, await state(ch));
        if (req.method === 'GET' && (action === 'latest' || version)) {
          const s = await state(ch), wanted = version ?? s.current;
          if (!wanted || !s.releases.some(r => r.version === wanted)) throw new HttpError(404, 'No such channel release.');
          const etag = `"${ch}-${s.sequence}-${s.hint}-${wanted}"`;
          if (req.headers['if-none-match'] === etag) { res.writeHead(304, {etag}); return res.end(); }
          return json(res, 200, {...await readJson(join(root, ch, wanted, 'manifest.json')), sequence: s.sequence, hint: s.hint, githubTag: s.githubTag}, {etag});
        }
      }
      if (req.url === '/v1/manager/invitations' && req.method === 'POST') {
        await authorize(req, 'dev', true);
        const input = JSON.parse(await body(req, 4096));
        if (!/^[a-zA-Z0-9_-]{1,80}$/.test(input.id) || !Array.isArray(input.channels) || !input.channels.length || input.channels.some(ch => !['dev', 'public'].includes(ch))) throw new HttpError(400, 'Invalid invitation.');
        const token = randomBytes(32).toString('base64url');
        await exclusive(async () => {
          const db = await readJson(authFile);
          if (db.clients?.[input.id]) throw new HttpError(409, 'Invitation ID already exists; revoke it before issuing a new ID.');
          db.clients = {...db.clients, [input.id]: {digest: hash(token), channels: input.channels}};
          await atomicJson(authFile, db);
        });
        return json(res, 201, {id: input.id, token, channels: input.channels});
      }
      const revoke = /^\/v1\/manager\/invitations\/([a-zA-Z0-9_-]{1,80})$/.exec(req.url ?? '');
      if (revoke && req.method === 'DELETE') {
        await authorize(req, 'dev', true);
        await exclusive(async () => { const db = await readJson(authFile); if (db.clients?.[revoke[1]]) { db.clients[revoke[1]].revoked = true; await atomicJson(authFile, db); } });
        return json(res, 200, {revoked: true});
      }
      throw new HttpError(404, 'Unknown release endpoint.');
    } catch (error) {
      // Never echo request headers, body, paths, remote errors or credentials.
      if (!res.headersSent && !res.destroyed) json(res, error.status ?? (error instanceof SyntaxError ? 400 : 422), {error: error.status ? error.message : 'Release request rejected.'});
      else res.destroy();
    }
  });
  server.requestTimeout = 120_000;
  server.headersTimeout = 15_000;
  return {server, publish, hint, state, objectFile};
}
