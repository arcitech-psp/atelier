// Authenticated channel updates. The running host is never stopped or changed.
import {createReadStream, createWriteStream} from 'node:fs';
import {chmod, lstat, mkdir, readFile, rename, rm, symlink, copyFile, stat} from 'node:fs/promises';
import {createHash, randomUUID} from 'node:crypto';
import {join, relative, resolve} from 'node:path';
import {Transform} from 'node:stream';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {atomicJson, canonical, channel, compare, hash, readJson, safeParents, verifyRelease, within} from './release.mjs';

export function channelContext(env = process.env) {
  if (!env.ATELIER_RELEASE_URL) return null;
  const url = new URL(env.ATELIER_RELEASE_URL);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw Error('Invalid release service URL.');
  return {url: url.href.replace(/\/$/, ''), channel: channel(env.ATELIER_UPDATE_CHANNEL || 'public'),
    root: resolve(env.ATELIER_CHANNEL_ROOT || join(env.ATELIER_HOME || env.DSH_HOME || 'user-home', 'channel-install')),
    keyFile: env.ATELIER_RELEASE_KEY_FILE, publicKey: env.ATELIER_RELEASE_PUBLIC_KEY,
    token: env.ATELIER_RELEASE_TOKEN, tokenFile: env.ATELIER_RELEASE_TOKEN_FILE,
    intervalMs: Math.max(30_000, Number(env.ATELIER_UPDATE_INTERVAL_MS) || 600_000),
    platform: process.platform === 'win32' ? 'windows' : 'linux'};
}
const journalPath = ctx => join(ctx.root, 'channel-state.json');
async function credentials(ctx) {
  const token = ctx.token || (ctx.tokenFile && (await readFile(ctx.tokenFile, 'utf8')).trim());
  const key = ctx.publicKey || (ctx.keyFile && await readFile(ctx.keyFile, 'utf8'));
  if (!token || !key) throw Error('Configure a channel invitation and pinned release public key.');
  return {token, key};
}
async function request(ctx, path, options = {}) {
  const {token} = await credentials(ctx);
  const response = await (ctx.fetchImpl ?? fetch)(`${ctx.url}/v1/channels/${ctx.channel}/${path}`, {
    ...options, headers: {...options.headers, authorization: `Bearer ${token}`}, redirect: 'error', signal: options.signal ?? AbortSignal.timeout(30_000),
  });
  if (!response.ok && response.status !== 304) throw Error(`Release service answered HTTP ${response.status}.`);
  return response;
}
export async function channelState(ctx) {
  const s = await readJson(journalPath(ctx), {channel: ctx.channel, current: null, previous: null, pending: null, highest: null, auto: false, blocked: null});
  if (s.channel !== ctx.channel) throw Error('This installation belongs to another channel; use a separate installation root.');
  return s;
}
async function locked(ctx, operation) {
  await mkdir(ctx.root, {recursive: true});
  const file = join(ctx.root, '.update-lock');
  // A process crash leaves a visible lock instead of admitting two writers to one journal.
  try { await mkdir(file); }
  catch (error) { if (error.code === 'EEXIST') throw Error('Another update is active, or a crashed updater left .update-lock; inspect it before retrying.'); throw error; }
  try { await atomicJson(join(file, 'owner.json'), {pid: process.pid, at: new Date().toISOString()}); return await operation(); }
  finally { await rm(file, {recursive: true, force: true}); }
}
export async function channelStatus(ctx) {
  const s = await channelState(ctx);
  return {channel: ctx.channel, current: s.current, previous: s.previous, pending: s.pending, auto: s.auto,
    lastCheck: s.lastCheck ?? null, latest: s.latest ?? null, githubTag: s.githubTag ?? null, intervalMs: ctx.intervalMs,
    blocked: s.blocked, restartRequired: !!s.pending};
}
export async function checkChannel(ctx) {
  return locked(ctx, async () => {
    const s = await channelState(ctx);
    const response = await request(ctx, 'latest', {headers: s.etag ? {'if-none-match': s.etag} : {}});
    if (response.status === 304) return {changed: false, ...(await channelStatus(ctx))};
    const raw = await limitedResponse(response, 24 * 1024 ** 2);
    const envelope = JSON.parse(raw);
    const {key} = await credentials(ctx), m = verifyRelease(envelope, key, ctx.channel);
    if (m.platform !== 'any' && m.platform !== ctx.platform) throw Error('This release is for another platform.');
    if (s.highest && compare(m.version, s.highest) < 0) throw Error('Release service offered an older version; only local rollback may downgrade.');
    const manifestFile = join(ctx.root, 'checked-manifest.json');
    await atomicJson(manifestFile, envelope);
    const changed = s.latest !== m.version || s.manifestHash !== hash(canonical(m));
    if (s.latest === m.version && s.manifestHash && s.manifestHash !== hash(canonical(m))) throw Error('A published version changed its content.');
    await atomicJson(journalPath(ctx), {...s, etag: response.headers.get('etag'), latest: m.version,
      highest: !s.highest || compare(m.version, s.highest) > 0 ? m.version : s.highest,
      manifestHash: hash(canonical(m)), lastCheck: new Date().toISOString(), githubTag: envelope.githubTag ?? null});
    return {changed, ...(await channelStatus(ctx))};
  });
}
async function limitedResponse(response, limit) {
  let size = 0; const chunks = [];
  for await (const chunk of response.body) { size += chunk.length; if (size > limit) throw Error('Release response is too large.'); chunks.push(chunk); }
  return Buffer.concat(chunks);
}
async function verifyFiles(directory, m) {
  for (const f of m.files.filter(f => !f.link)) {
    const file = within(directory, f.path), info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size !== f.size) throw Error('Installed release file does not match its manifest.');
    const sha = createHash('sha256');
    for await (const chunk of createReadStream(file)) sha.update(chunk);
    if (sha.digest('hex') !== f.sha256) throw Error('Installed release checksum mismatch.');
  }
}
export async function stageChannel(ctx) {
  return locked(ctx, async () => {
    const s = await channelState(ctx), envelope = await readJson(join(ctx.root, 'checked-manifest.json'));
    const {key} = await credentials(ctx), m = verifyRelease(envelope, key, ctx.channel);
    if (hash(canonical(m)) !== s.manifestHash || m.version !== s.latest) throw Error('Check the release again before installing.');
    if (s.blocked === m.version) throw Error('This version was rolled back. Publish a newer release or explicitly check and install another version.');
    if (s.highest && compare(m.version, s.highest) < 0) throw Error('A stale checked release cannot be installed.');
    if (s.current === m.version || s.pending === m.version) return channelStatus(ctx);
    const directory = join(ctx.root, 'versions', m.version), app = join(directory, 'app');
    const partial = join(ctx.root, 'versions', `.${m.version}.${randomUUID()}.partial`);
    await mkdir(join(partial, 'app'), {recursive: true});
    try {
      let next = 0;
      const files = m.files.filter(f => !f.link);
      // Small bounded pool; a failed transfer settles every writer before cleanup.
      const results = await Promise.allSettled(Array.from({length: Math.min(4, files.length)}, async () => {
        while (next < files.length) {
          const f = files[next++], target = await safeParents(join(partial, 'app'), f.path);
          const response = await request(ctx, `objects/${f.sha256}`, {signal: AbortSignal.timeout(120_000)});
          let size = 0; const sha = createHash('sha256');
          const count = new Transform({transform(chunk, _, done) {
            size += chunk.length; if (size > f.size) return done(Error('Artifact exceeded its declared size.'));
            sha.update(chunk); done(null, chunk);
          }});
          await pipeline(Readable.fromWeb(response.body), count, createWriteStream(target, {flags: 'wx', mode: f.executable ? 0o755 : 0o644}));
          if (size !== f.size || sha.digest('hex') !== f.sha256) throw Error('Downloaded artifact checksum mismatch.');
        }
      }));
      const failure = results.find(r => r.status === 'rejected');
      if (failure) throw failure.reason;
      for (const f of m.files.filter(f => f.link)) {
        const target = await safeParents(join(partial, 'app'), f.path), linkTarget = within(join(partial, 'app'), f.link);
        const info = await lstat(linkTarget);
        if (info.isSymbolicLink()) throw Error('Release link resolves through another link.');
        if (process.platform === 'win32' && info.isFile()) await copyFile(linkTarget, target);
        else await symlink(process.platform === 'win32' ? linkTarget : relative(resolve(target, '..'), linkTarget), target, info.isDirectory() ? (process.platform === 'win32' ? 'junction' : 'dir') : 'file');
      }
      await atomicJson(join(partial, 'manifest.json'), envelope);
      if (await accessExists(directory)) {
        // Immutable local versions may be reused only after verifying all content.
        const saved = await readJson(join(directory, 'manifest.json'));
        if (hash(canonical(saved.manifest)) !== hash(canonical(m))) throw Error('Local version has conflicting content.');
        await verifyFiles(app, m);
      } else await rename(partial, directory);
      await atomicJson(journalPath(ctx), {...s, pending: m.version, stagedAt: new Date().toISOString()});
    } finally { await rm(partial, {recursive: true, force: true}); }
    return channelStatus(ctx);
  });
}
const accessExists = file => stat(file).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
export async function activatePending(ctx) {
  return locked(ctx, async () => {
    const s = await channelState(ctx);
    if (!s.pending) return s;
    const directory = join(ctx.root, 'versions', s.pending), envelope = await readJson(join(directory, 'manifest.json'));
    const {key} = await credentials(ctx), m = verifyRelease(envelope, key, ctx.channel);
    if (m.version !== s.pending) throw Error('Pending release identity mismatch.');
    await verifyFiles(join(directory, 'app'), m);
    const next = {...s, previous: s.current, current: s.pending, pending: null, activatedAt: new Date().toISOString()};
    await atomicJson(journalPath(ctx), next);
    return next;
  });
}
export async function rollbackChannel(ctx) {
  return locked(ctx, async () => {
    const s = await channelState(ctx);
    if (!s.previous) throw Error('No previous channel version is installed.');
    await atomicJson(journalPath(ctx), {...s, pending: s.previous, blocked: s.current});
    return channelStatus(ctx);
  });
}
export async function configureChannel(ctx, {auto}) {
  return locked(ctx, async () => { const s = await channelState(ctx); await atomicJson(journalPath(ctx), {...s, auto: auto === true}); return channelStatus(ctx); });
}
export async function cancelChannel(ctx) {
  return locked(ctx, async () => { const s = await channelState(ctx); await atomicJson(journalPath(ctx), {...s, pending: null}); return channelStatus(ctx); });
}
