#!/usr/bin/env node
// All credentials are read from the environment/protected runtime files, never command arguments.
import {generateKeyPairSync} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {chmod, copyFile, lstat, mkdir, readFile, readdir, readlink, realpath, writeFile} from 'node:fs/promises';
import {dirname, isAbsolute, join, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {FORMAT, atomicJson, canonical, hash, portablePath, readJson, seal, validateManifest, verifyRelease, within} from './release.mjs';
import {activatePending, cancelChannel, channelContext, channelStatus, checkChannel, configureChannel, rollbackChannel, stageChannel} from './channel-client.mjs';
import {createReleaseServer} from './release-server.mjs';
import {pollGithub} from './github.mjs';

export async function packRelease(spec, privateKey) {
  const root = resolve(spec.root), files = [], seen = new Set(), sources = new Map();
  if (!Array.isArray(spec.include) || !spec.include.length) throw Error('Explicit release include paths are required.');
  const skip = name => /(?:^|\/)(?:\.git|\.cache|\.tooling|user-home|sessions|logs|test-results|_review|\.update-lock)(?:\/|$)/.test(name)
    || /(?:\.before-|\.bak$|\.log$|\.upload$|\.tmp$)/.test(name);
  const kind = name => spec.kinds?.[name] ?? (name.includes('node_modules/') ? 'dependency' : /(?:^|\/)client\.(?:js|mjs)$|web\/dist\//.test(name) ? 'client'
    : /(?:^|\/)presets\//.test(name) ? 'preset' : /(?:^|\/)profiles\//.test(name) ? 'profile' : /\.(?:mjs|js|ts|tsx)$/.test(name) ? 'module' : 'application');
  async function visit(name) {
    portablePath(name);
    if (seen.has(name) || skip(name)) return;
    seen.add(name);
    const file = within(root, name), info = await lstat(file);
    if (info.isSymbolicLink()) {
      const target = await realpath(file), rel = relative(root, target);
      if (rel.startsWith('..') || isAbsolute(rel)) throw Error('A source link leaves the application root.');
      const link = rel.split(sep).join('/');
      portablePath(link);
      files.push({path: name, link, sha256: hash(link), size: Buffer.byteLength(link), kind: kind(name)});
      await visit(link);
    } else if (info.isDirectory()) {
      for (const child of (await readdir(file)).sort()) await visit(`${name}/${child}`);
    } else if (info.isFile()) {
      const data = await readFile(file), sha256 = hash(data);
      files.push({path: name, sha256, size: data.length, kind: kind(name), ...(info.mode & 0o111 ? {executable: true} : {})});
      sources.set(sha256, file);
    } else throw Error('Unsupported source filesystem entry.');
  }
  for (const name of spec.include) await visit(name);
  files.sort((a, b) => a.path.localeCompare(b.path, 'en'));
  const manifest = {format: FORMAT, channel: spec.channel, version: spec.version, platform: spec.platform || 'any',
    createdAt: spec.createdAt || new Date().toISOString(), sourceRevision: spec.sourceRevision,
    defaultProfile: spec.defaultProfile, presets: spec.presets, profiles: spec.profiles, features: spec.features,
    entrypoint: spec.entrypoint, files};
  validateManifest(manifest);
  const output = resolve(spec.output);
  await mkdir(join(output, 'objects'), {recursive: true});
  for (const [digest, file] of sources) await copyFile(file, join(output, 'objects', digest));
  const envelope = seal(manifest, privateKey);
  await atomicJson(join(output, 'manifest.json'), envelope);
  return {output, channel: manifest.channel, version: manifest.version, files: files.length, objects: sources.size, sha256: hash(canonical(manifest))};
}

export async function publishRelease({directory, url, token, fetchImpl = fetch}) {
  if (!token || !url) throw Error('Set the release service URL and manager token.');
  const envelope = await readJson(join(directory, 'manifest.json')), m = validateManifest(envelope.manifest);
  const base = `${url.replace(/\/$/, '')}/v1/channels/${m.channel}`;
  const headers = {authorization: `Bearer ${token}`};
  const objects = [...new Set(m.files.filter(f => !f.link).map(f => f.sha256))];
  let next = 0;
  const workers = await Promise.allSettled(Array.from({length: Math.min(4, objects.length)}, async () => {
    while (next < objects.length) {
      const digest = objects[next++], file = join(directory, 'objects', digest);
      const response = await fetchImpl(`${base}/objects/${digest}`, {method: 'PUT', headers, body: createReadStream(file), duplex: 'half', redirect: 'error', signal: AbortSignal.timeout(120_000)});
      if (!response.ok) throw Error(`Upload rejected: HTTP ${response.status}.`);
      await response.arrayBuffer();
    }
  }));
  const failed = workers.find(r => r.status === 'rejected');
  if (failed) throw failed.reason;
  const result = await fetchImpl(`${base}/releases`, {method: 'POST', headers: {...headers, 'content-type': 'application/json'}, body: JSON.stringify(envelope), redirect: 'error', signal: AbortSignal.timeout(300_000)});
  if (!result.ok) throw Error(`Publish rejected: HTTP ${result.status}.`);
  return result.json();
}

export async function main(args = process.argv.slice(2), env = process.env) {
  const [command, input] = args;
  if (command === 'serve') {
    const config = await readJson(input);
    const keys = {dev: await readFile(config.keys.dev, 'utf8'), public: await readFile(config.keys.public, 'utf8')};
    const service = await createReleaseServer({...config, keys, webhookSecret: env.ATELIER_GITHUB_WEBHOOK_SECRET});
    await new Promise((done, reject) => { service.server.once('error', reject); service.server.listen(config.port || 8431, config.host || '127.0.0.1', done); });
    process.stdout.write(`Release service listening on port ${service.server.address().port}.\n`);
    if (Object.keys(config.github || {}).length) {
      let polling = false;
      const timer = setInterval(async () => {
        if (polling) return;
        polling = true;
        try { await pollGithub(service, config.github); } catch { process.stderr.write('GitHub channel check failed.\n'); }
        finally { polling = false; }
      }, Math.max(60_000, config.githubPollIntervalMs || 600_000));
      timer.unref();
      service.server.once('close', () => clearInterval(timer));
    }
    return;
  }
  if (command === 'keygen') {
    if (!input) throw Error('Choose a protected signing-key directory outside the application and release folders.');
    await mkdir(input, {recursive: true, mode: 0o700});
    const {privateKey, publicKey} = generateKeyPairSync('ed25519');
    await writeFile(join(input, 'private.pem'), privateKey.export({type: 'pkcs8', format: 'pem'}), {flag: 'wx', mode: 0o600});
    await writeFile(join(input, 'public.pem'), publicKey.export({type: 'spki', format: 'pem'}), {flag: 'wx', mode: 0o644});
    return {created: true};
  }
  if (command === 'pack') {
    const spec = await readJson(input);
    if (!env.ATELIER_SIGNING_KEY_FILE) throw Error('Set ATELIER_SIGNING_KEY_FILE outside the application/release tree.');
    const key = await readFile(env.ATELIER_SIGNING_KEY_FILE, 'utf8');
    return packRelease(spec, key);
  }
  if (command === 'publish') return publishRelease({directory: resolve(input), url: env.ATELIER_RELEASE_URL, token: env.ATELIER_MANAGER_TOKEN});
  const ctx = channelContext(env);
  if (!ctx) throw Error('Set ATELIER_RELEASE_URL, ATELIER_UPDATE_CHANNEL, ATELIER_CHANNEL_ROOT and a pinned channel key/invitation.');
  if (command === 'status') return channelStatus(ctx);
  if (command === 'check') return checkChannel(ctx);
  if (command === 'stage') { await checkChannel(ctx); return stageChannel(ctx); }
  if (command === 'rollback') return rollbackChannel(ctx);
  if (command === 'cancel') return cancelChannel(ctx);
  if (command === 'auto') return configureChannel(ctx, {auto: input === 'on'});
  if (command === 'activate') return activatePending(ctx);
  if (command === 'launch') {
    const s = await activatePending(ctx);
    if (!s.current) throw Error('No channel release is installed. Check and stage one first.');
    const directory = join(ctx.root, 'versions', s.current), envelope = await readJson(join(directory, 'manifest.json'));
    const app = join(directory, 'app');
    const child = spawn(process.execPath, [within(app, envelope.manifest.entrypoint), ...args.slice(1)], {
      cwd: app, windowsHide: true, stdio: 'inherit', env: {...env, ATELIER_DEFAULT_PROFILE: envelope.manifest.defaultProfile,
        ATELIER_UPDATE_CHANNEL: ctx.channel, ATELIER_BUILD_VERSION: envelope.manifest.version},
    });
    child.once('error', () => { process.exitCode = 1; });
    child.once('exit', code => { process.exitCode = code ?? 1; });
    return;
  }
  if (command === 'watch') {
    const tick = async () => { try { const s = await checkChannel(ctx); if (s.auto && s.latest !== s.current && s.latest !== s.pending) await stageChannel(ctx); } catch { process.stderr.write('Channel check failed; current version retained.\n'); } };
    await tick();
    setInterval(tick, ctx.intervalMs);
    return;
  }
  throw Error('Commands: serve, keygen, pack, publish, status, check, stage, rollback, cancel, auto on|off, activate, launch, watch.');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(value => { if (value !== undefined) process.stdout.write(`${JSON.stringify(value)}\n`); }, () => { process.stderr.write('Release operation failed. Check configuration, signature, channel access and service health.\n'); process.exitCode = 1; });
}
