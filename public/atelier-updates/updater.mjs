// Atelier updater core: check GitHub Releases, download, verify SHA-256, install side by side, switch, roll back.
// Nothing here runs on its own. Atelier contacts GitHub only when the person presses "Check for updates" or
// turns automatic updates on (off by default).
//
// Installed layout (both platforms), under the install root:
//   versions/<version>/app        the application (this repository, with its packages)
//   versions/<version>/runtime    the Node.js runtime it runs on
//   current                       text file: the version the launcher starts
//   previous                      text file: the version to roll back to
//   pending                       text file: a version the launcher switches to on its next start
// The launcher (Windows tray app or the Linux `atelier-preview` script) promotes `pending` when it starts,
// writing the old `current` into `previous`, and restarts Atelier when it exits with code 75.
import {createHash} from 'node:crypto';
import {createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';

export const DEFAULT_REPO = 'arcitech-psp/atelier';
export const RESTART_EXIT_CODE = 75;
const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '..', '..');
const readJson = (path, fallback) => { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return fallback; } };
const readText = path => { try { return readFileSync(path, 'utf8').trim() || null; } catch { return null; } };

/** "0.1.0-preview" -> "0.1.0": release assets and version folders use the plain number. */
export const plainVersion = version => String(version).replace(/^v/, '').replace(/-preview$/, '');

/** Compare two versions: numbers first, then a pre-release tag sorts before the plain release. */
export function compareVersions(a, b) {
  const parse = v => { const m = /^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/.exec(plainVersion(v)); return m ? [+m[1], +m[2], +m[3], m[4] ?? ''] : [0, 0, 0, String(v)]; };
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  if (x[3] === y[3]) return 0;
  if (!x[3]) return 1;
  if (!y[3]) return -1;
  return x[3].localeCompare(y[3], 'en', {numeric: true});
}

/** Where this copy of Atelier runs from, and how it was installed. */
export function context(env = process.env) {
  const pkg = readJson(join(appRoot, 'package.json'), {});
  const dsh = readJson(join(appRoot, 'harness', 'apps', 'cli', 'package.json'), {});
  const installRoot = env.ATELIER_INSTALL_ROOT ? resolve(env.ATELIER_INSTALL_ROOT) : null;
  const platform = process.platform === 'win32' ? 'windows' : process.platform === 'linux' ? 'linux' : 'other';
  return {
    appRoot, installRoot, platform,
    mode: installRoot && existsSync(join(installRoot, 'versions')) ? 'installed' : 'source',
    version: pkg.version ?? '0.0.0', plain: plainVersion(pkg.version ?? '0.0.0'),
    dshVersion: dsh.version ?? 'unknown',
    home: resolve(env.DSH_HOME || env.ATELIER_HOME || join(appRoot, 'user-home')),
    repo: env.ATELIER_UPDATE_REPO || DEFAULT_REPO,
  };
}

const configPath = ctx => join(ctx.home, 'atelier-updates.json');
export const readConfig = ctx => ({auto: false, ...readJson(configPath(ctx), {})});
export function writeConfig(ctx, patch) {
  const next = {...readConfig(ctx), ...patch};
  mkdirSync(ctx.home, {recursive: true});
  writeFileSync(configPath(ctx), JSON.stringify(next, null, 2));
  return next;
}

/** current / previous / pending and the version folders present. */
export function installState(ctx) {
  if (ctx.mode !== 'installed') return {current: ctx.plain, previous: null, pending: null, versions: []};
  const root = ctx.installRoot;
  const versions = readdirSync(join(root, 'versions'), {withFileTypes: true})
    .filter(e => e.isDirectory() && existsSync(join(root, 'versions', e.name, 'app', 'start-preview.mjs'))).map(e => e.name)
    .sort(compareVersions);
  return {current: readText(join(root, 'current')) ?? ctx.plain, previous: readText(join(root, 'previous')),
    pending: readText(join(root, 'pending')), versions};
}

const assetPattern = ctx => ctx.platform === 'windows' ? /^Atelier-Preview-(.+)-Setup\.exe$/ : /^atelier-preview-(.+)-linux-x64\.tar\.gz$/;
const allowedDownloadHost = url => { try { const u = new URL(url); return u.protocol === 'https:' && u.hostname === 'github.com'; } catch { return false; } };

/** Ask GitHub for the newest release of the configured repository that has an installer for this platform. */
export async function check(ctx, {fetchImpl = fetch} = {}) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(ctx.repo)) throw Error(`The update repository "${ctx.repo}" is not an owner/name slug.`);
  const response = await fetchImpl(`https://api.github.com/repos/${ctx.repo}/releases?per_page=20`, {
    headers: {accept: 'application/vnd.github+json', 'user-agent': `Atelier-Updater/${ctx.plain}`},
    signal: AbortSignal.timeout(15000),
  });
  if (response.status === 404) throw Error(`No public releases found at github.com/${ctx.repo} yet.`);
  if (!response.ok) throw Error(`GitHub answered HTTP ${response.status}. Try again later.`);
  const releases = await response.json();
  let best = null;
  for (const release of Array.isArray(releases) ? releases : []) {
    if (release.draft) continue;
    const asset = (release.assets ?? []).find(a => assetPattern(ctx).test(a.name));
    const sums = (release.assets ?? []).find(a => a.name === 'SHA256SUMS');
    if (!asset || !sums) continue;
    const version = plainVersion(assetPattern(ctx).exec(asset.name)[1]);
    if (!best || compareVersions(version, best.version) > 0) {
      best = {version, tag: release.tag_name, page: release.html_url, notes: String(release.body ?? '').slice(0, 4000),
        published: release.published_at, asset: {name: asset.name, url: asset.browser_download_url, size: asset.size},
        sums: {url: sums.browser_download_url}};
    }
  }
  const state = installState(ctx);
  const result = {checkedAt: new Date().toISOString(), current: state.current, latest: best,
    newer: !!best && compareVersions(best.version, state.current) > 0};
  writeConfig(ctx, {lastCheck: result.checkedAt, lastSeen: best?.version ?? null});
  return result;
}

async function download(url, target, {fetchImpl = fetch, maxBytes = 1.5 * 1024 ** 3, onProgress} = {}) {
  if (!allowedDownloadHost(url)) throw Error(`Refusing to download from ${url}: only github.com release assets are used.`);
  const response = await fetchImpl(url, {headers: {'user-agent': 'Atelier-Updater'}, redirect: 'follow', signal: AbortSignal.timeout(30 * 60 * 1000)});
  if (!response.ok || !response.body) throw Error(`Download failed (HTTP ${response.status}).`);
  const hash = createHash('sha256');
  let bytes = 0;
  const total = Number(response.headers.get('content-length')) || 0;
  const counted = Readable.fromWeb(response.body).map(chunk => {
    bytes += chunk.length;
    if (bytes > maxBytes) throw Error('The download is larger than any Atelier release should be.');
    hash.update(chunk);
    onProgress?.({bytes, total});
    return chunk;
  });
  mkdirSync(dirname(target), {recursive: true});
  await pipeline(counted, createWriteStream(target));
  return hash.digest('hex');
}

const run = (command, args, options = {}) => new Promise((done, failed) => {
  const child = spawn(command, args, {windowsHide: true, stdio: 'ignore', ...options});
  child.once('error', failed);
  child.once('exit', code => code === 0 ? done() : failed(Error(`${command} exited with code ${code}`)));
});

/**
 * Download the release found by check(), verify its SHA-256 against the release's SHA256SUMS, and install it
 * next to the running version. Nothing switches until the launcher next starts (or restart() is called).
 */
export async function install(ctx, latest, {fetchImpl = fetch, onProgress} = {}) {
  if (ctx.mode !== 'installed') throw Error('This copy runs from source. Update it with git (see docs/UPSTREAM_SYNC.md) or install a release.');
  if (!latest?.asset?.url || !latest?.sums?.url) throw Error('Check for updates first.');
  const version = plainVersion(latest.version);
  if (!/^[0-9A-Za-z.-]+$/.test(version)) throw Error('Unexpected version name in the release.');
  const root = ctx.installRoot;
  const work = join(ctx.home, 'updates', version);
  mkdirSync(work, {recursive: true});
  const sumsFile = join(work, 'SHA256SUMS');
  await download(latest.sums.url, sumsFile, {fetchImpl, maxBytes: 1024 * 1024});
  const expected = readFileSync(sumsFile, 'utf8').split(/\r?\n/)
    .map(line => /^([a-f0-9]{64})\s+\*?(.+)$/i.exec(line.trim())).find(m => m && m[2] === latest.asset.name)?.[1]?.toLowerCase();
  if (!expected) throw Error(`SHA256SUMS does not list ${latest.asset.name}; not installing.`);
  const file = join(work, latest.asset.name);
  const actual = await download(latest.asset.url, file, {fetchImpl, onProgress});
  if (actual !== expected) {
    rmSync(file, {force: true});
    throw Error(`The download's SHA-256 does not match the release (${actual.slice(0, 12)}... vs ${expected.slice(0, 12)}...); it was discarded.`);
  }
  const target = join(root, 'versions', version);
  if (ctx.platform === 'windows') {
    // The installer in update mode adds versions\<version> beside the running one and marks it pending.
    await run(file, ['/S', '/UPDATE']);
  } else {
    const partial = `${target}.partial`;
    rmSync(partial, {recursive: true, force: true});
    mkdirSync(partial, {recursive: true});
    await run('tar', ['-xzf', file, '-C', partial, '--strip-components=1']);
    if (!existsSync(join(partial, 'app', 'start-preview.mjs'))) throw Error('The downloaded archive is not an Atelier release.');
    rmSync(target, {recursive: true, force: true});
    renameSync(partial, target);
    writeFileSync(join(root, 'pending'), version);
  }
  if (!existsSync(join(target, 'app', 'start-preview.mjs'))) throw Error('The update did not install completely; your current version is unchanged.');
  if (readText(join(root, 'pending')) !== version) writeFileSync(join(root, 'pending'), version);
  prune(ctx);
  return {installed: version, pending: version};
}

/** Keep the running version, the previous one and anything pending; remove older version folders. */
export function prune(ctx, keep = 3) {
  const state = installState(ctx);
  const protectedVersions = new Set([state.current, state.previous, state.pending, ctx.plain].filter(Boolean));
  const others = state.versions.filter(v => !protectedVersions.has(v)).sort(compareVersions).reverse();
  const room = Math.max(0, keep - protectedVersions.size);
  for (const version of others.slice(room)) {
    // fs.rm removes links (pnpm's node_modules junctions) without following them.
    rmSync(join(ctx.installRoot, 'versions', version), {recursive: true, force: true, maxRetries: 3});
  }
}

/** Mark the previous version to start next; the launcher switches when Atelier restarts. */
export function rollback(ctx) {
  const state = installState(ctx);
  if (ctx.mode !== 'installed') throw Error('Rollback is for installed copies; this one runs from source.');
  if (!state.previous || !state.versions.includes(state.previous)) throw Error('There is no previous version to roll back to.');
  writeFileSync(join(ctx.installRoot, 'pending'), state.previous);
  return {pending: state.previous};
}

/** Undo a staged update or rollback before it is applied. */
export function cancelPending(ctx) {
  if (ctx.mode === 'installed') rmSync(join(ctx.installRoot, 'pending'), {force: true});
  return installState(ctx);
}

// ---- Small API for other front ends (the `atelier` CLI/TUI): import from '@arcitech/atelier-updates/updater'.
/** Version, install mode, kept versions and the automatic-update setting. Never contacts the network. */
export const updateStatus = (ctx = context()) => ({...installState(ctx), version: ctx.plain, dshVersion: ctx.dshVersion,
  mode: ctx.mode, repo: ctx.repo, auto: readConfig(ctx).auto === true});
/** Ask GitHub Releases for a newer version: {current, latest, newer}. */
export const checkForUpdate = (ctx = context()) => check(ctx);
/** Check, then download + verify + install the newer version beside this one; it starts on the next launch. */
export async function applyUpdate(ctx = context(), options = {}) {
  const result = await check(ctx);
  if (!result.newer) return {installed: null, current: result.current};
  return install(ctx, result.latest, options);
}
/** Make the previous version start on the next launch. */
export const rollbackUpdate = (ctx = context()) => rollback(ctx);