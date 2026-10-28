// Channel release format, signatures, version ordering and portable filesystem rules.
import {createHash, randomUUID, sign, verify} from 'node:crypto';
import {lstat, mkdir, readFile, rename, writeFile} from 'node:fs/promises';
import {dirname, isAbsolute, relative, resolve} from 'node:path';

export const FORMAT = 'atelier.channel-release.v1';
export const CHANNELS = ['dev', 'public'];
export const hash = value => createHash('sha256').update(value).digest('hex');
export const canonical = value => JSON.stringify(Array.isArray(value) ? value.map(sortValue) : sortValue(value));
function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, sortValue(value[k])]));
  return value;
}

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?$/;
export function versionParts(value) {
  const m = typeof value === 'string' && SEMVER.exec(value);
  if (!m || value.length > 100) throw Error('Expected a semantic version without build metadata.');
  if (m.slice(1, 4).some(n => !Number.isSafeInteger(Number(n)))) throw Error('Version is too large.');
  return [Number(m[1]), Number(m[2]), Number(m[3]), m[4]?.split('.') ?? []];
}
export function compare(a, b) {
  const x = versionParts(a), y = versionParts(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  if (!x[3].length || !y[3].length) return Number(!x[3].length) - Number(!y[3].length);
  for (let i = 0; i < Math.max(x[3].length, y[3].length); i++) {
    const l = x[3][i], r = y[3][i];
    if (l === r) continue;
    if (l === undefined || r === undefined) return l === undefined ? -1 : 1;
    const ln = /^\d+$/.test(l), rn = /^\d+$/.test(r);
    if (ln && rn) return BigInt(l) < BigInt(r) ? -1 : 1;
    if (ln !== rn) return ln ? -1 : 1;
    return l < r ? -1 : 1;
  }
  return 0;
}
export function channel(value) {
  if (!CHANNELS.includes(value)) throw Error('Unknown release channel.');
  return value;
}

export function portablePath(value) {
  if (typeof value !== 'string' || !value || value.length > 900 || /[\\\x00-\x1f:]/.test(value) || value.startsWith('/')) throw Error('Unsafe release path.');
  if (value.split('/').some(p => !p || p === '.' || p === '..' || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))) throw Error('Unsafe release path.');
  return value;
}
export function within(root, name) {
  portablePath(name);
  const target = resolve(root, ...name.split('/')), rel = relative(resolve(root), target);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw Error('Release path escapes its root.');
  return target;
}
export async function safeParents(root, name) {
  const parts = portablePath(name).split('/');
  let here = resolve(root);
  for (const part of parts.slice(0, -1)) {
    here = resolve(here, part);
    const stat = await lstat(here).catch(error => { if (error.code !== 'ENOENT') throw error; });
    if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) throw Error('A release parent is not a real directory.');
    if (!stat) await mkdir(here).catch(error => { if (error.code !== 'EEXIST') throw error; });
    const confirmed = await lstat(here);
    if (!confirmed.isDirectory() || confirmed.isSymbolicLink()) throw Error('A release parent is not a real directory.');
  }
  return within(root, name);
}

const PRIVATE_MARKERS = [
  ['10.0.0', '.'].join(''), ['Users', '\\', 'parth'].join(''), ['Users', '/', 'parth'].join(''),
  ['/home', '/', 'psp'].join(''), ['HA', 'DES'].join(''), ['POSE', 'IDON'].join(''), ['ZE', 'US'].join(''),
  ['At', 'las'].join(''), ['Her', 'cules'].join(''), ['Hel', 'la'].join(''), ['Cal', 'gary'].join(''),
  ['E', 'G2'].join(''), ['Comfy', 'UI'].join(''), ['Cold', ' Fusion'].join(''),
  ['dsh-', 'ha', 'des-', 'unreal'].join(''), ['file:', '//', '/'].join(''),
];
export function assertPublicText(value) {
  const text = String(value).toLowerCase();
  if (PRIVATE_MARKERS.some(marker => {
    const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = /^[a-z]+$/i.test(marker) || /^[a-z]+ [a-z]+$/i.test(marker) ? `\\b${escaped}\\b` : escaped;
    return new RegExp(pattern, 'i').test(text);
  })) throw Error('Public release contains a private marker.');
}
export function validateManifest(m, expectedChannel = m?.channel) {
  channel(expectedChannel);
  if (!m || m.format !== FORMAT || m.channel !== expectedChannel) throw Error('Release channel or format mismatch.');
  versionParts(m.version);
  if (typeof m.createdAt !== 'string' || !Number.isFinite(Date.parse(m.createdAt)) || typeof m.sourceRevision !== 'string' || m.sourceRevision.length > 100) throw Error('Release provenance is missing.');
  if (!Array.isArray(m.files) || !m.files.length || m.files.length > 100000) throw Error('Release file inventory is missing or too large.');
  if (!m.features || !['studioImages', 'studioVideo', 'ownerAssistant'].every(k => typeof m.features[k] === 'boolean')) throw Error('Feature policy is missing.');
  if (!Array.isArray(m.presets) || !m.presets.includes(m.defaultProfile) || !Array.isArray(m.profiles)) throw Error('Default profile is not included.');
  if (!['linux', 'windows', 'any'].includes(m.platform)) throw Error('Release platform is missing.');
  const paths = new Set();
  for (const f of m.files) {
    portablePath(f.path);
    const key = f.path.toLowerCase();
    if (paths.has(key)) throw Error('Duplicate release path.');
    paths.add(key);
    if (!/^[a-f0-9]{64}$/.test(f.sha256) || !Number.isSafeInteger(f.size) || f.size < 0 || f.size > 1024 ** 3) throw Error('Invalid release digest or size.');
    if (!['application', 'module', 'preset', 'profile', 'client', 'dependency', 'runtime'].includes(f.kind)) throw Error('Invalid release file kind.');
    if (f.link !== undefined) {
      portablePath(f.link);
      if (f.size !== Buffer.byteLength(f.link) || f.sha256 !== hash(f.link)) throw Error('Invalid release link.');
    }
    if (/^(?:user-home|sessions|workspaces|logs|\.git|\.agent-presets)(?:\/|$)/i.test(f.path)
      || /(?:^|\/)(?:\.env|connection\.cmd|host\.env|tokens\.json|settings\.yaml)(?:$|\/)/i.test(f.path) && !/^(?:defaults|profiles)\//.test(f.path)) throw Error('User state or credentials are not release files.');
  }
  for (const name of paths) {
    const parts = name.split('/');
    for (let i = 1; i < parts.length; i++) if (paths.has(parts.slice(0, i).join('/'))) throw Error('A release file is also a parent directory.');
  }
  const targets = new Set(), links = new Set(m.files.filter(f => f.link).map(f => f.path));
  for (const f of m.files) {
    const parts = f.path.split('/');
    for (let i = 1; i <= parts.length; i++) targets.add(parts.slice(0, i).join('/'));
  }
  for (const f of m.files.filter(f => f.link)) {
    if (!targets.has(f.link)) throw Error('A release link target is absent.');
    // Links never chain through another link; this also excludes cycles and parent links.
    const parts = f.link.split('/');
    if (parts.some((_, i) => links.has(parts.slice(0, i + 1).join('/')))) throw Error('Chained release links are not supported.');
  }
  if (!m.files.some(f => f.kind === 'client') || !m.files.some(f => f.kind === 'module')
    || !m.files.some(f => f.kind === 'preset') || !m.files.some(f => f.kind === 'profile')) throw Error('Release needs modules, presets, launcher profiles and a client bundle.');
  if (!m.files.some(f => f.path === m.entrypoint && !f.link)) throw Error('Application entrypoint is absent.');
  if (expectedChannel === 'public') {
    if (m.features.studioVideo || m.features.ownerAssistant || !m.features.studioImages) throw Error('Public feature policy rejected.');
    if (m.presets.some(p => /^(?:clippy|leonardo|gaudi|archimedes|hydra)$/i.test(p))) throw Error('Private profile in public release.');
    if (m.files.some(f => /(?:^|\/)(?:clippy|.*minimax.*|.*video-service.*)(?:\/|\.|$)/i.test(f.path))) throw Error('Private service in public release.');
    assertPublicText(canonical(m));
  }
  return m;
}

export function seal(manifest, privateKey) {
  validateManifest(manifest);
  return {manifest, signature: sign(null, Buffer.from(canonical(manifest)), privateKey).toString('base64')};
}
export function verifyRelease(envelope, publicKey, expectedChannel) {
  if (!envelope || typeof envelope.signature !== 'string' || envelope.signature.length > 200) throw Error('Release signature is missing.');
  validateManifest(envelope.manifest, expectedChannel);
  if (!verify(null, Buffer.from(canonical(envelope.manifest)), publicKey, Buffer.from(envelope.signature, 'base64'))) throw Error('Release signature verification failed.');
  return envelope.manifest;
}
export async function atomicJson(file, value) {
  await mkdir(dirname(file), {recursive: true});
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, {mode: 0o600});
  await rename(temp, file);
}
export async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT' && arguments.length > 1) return fallback; throw error; }
}
