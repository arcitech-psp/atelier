// "Set me up": the opt-in starter kit. It downloads the smallest working set (official llama.cpp server binaries plus
// GGUF models, and optionally whisper.cpp for speech) into a folder you choose, checks the disk space first, resumes
// interrupted downloads, verifies every file against the publisher's SHA-256, then starts one local server per role
// (loopback only, no window) and wires the roles to them. Windows, WSL and Linux (x64). Nothing runs until you ask.
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createReadStream, createWriteStream, existsSync, readFileSync, readdirSync, statSync, chmodSync, openSync, closeSync} from 'node:fs';
import {mkdir, readFile, rename, rm, stat, statfs, truncate, writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {basename, dirname, isAbsolute, join, resolve} from 'node:path';
import {Readable, Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {FILES, KIT_BRAINS, KIT_PORTS, TIERS} from './roles.mjs';

const MANIFEST = 'atelier-kit.json';
const MB = 1024 * 1024;

export function defaultKitFolder(env = process.env) {
  if (env.ATELIER_DATA_DIR) return join(env.ATELIER_DATA_DIR, 'models');
  if (process.platform === 'win32') return join(env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'Atelier', 'models');
  return join(env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'atelier', 'models');
}

export function platformInfo() {
  if (process.arch !== 'x64') return {supported: false, reason: `This kit supports x64 computers; this one is ${process.arch}.`};
  if (process.platform === 'win32') return {supported: true, os: 'win', label: 'Windows', vulkan: existsSync(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'vulkan-1.dll'))};
  if (process.platform === 'linux') {
    let wsl = false; try { wsl = /microsoft/i.test(readFileSync('/proc/version', 'utf8')); } catch {}
    const vulkan = ['/usr/lib/x86_64-linux-gnu/libvulkan.so.1', '/usr/lib64/libvulkan.so.1', '/usr/lib/libvulkan.so.1'].some(existsSync);
    return {supported: true, os: 'linux', label: wsl ? 'Linux (WSL)' : 'Linux', vulkan, wsl};
  }
  return {supported: false, reason: 'The kit supports Windows, WSL and Linux. On other systems, connect a model server yourself.'};
}

/** The files a kit needs for the choices given. */
export function kitFiles({tier = '8gb', brain = true, embeddings = true, speech = false} = {}, platform = platformInfo()) {
  if (!platform.supported) throw Error(platform.reason);
  if (!KIT_BRAINS[tier]) throw Error('Unknown graphics tier.');
  const gpu = tier !== 'cpu' && platform.vulkan;
  const ids = [];
  if (brain || embeddings) ids.push(`llama-${platform.os}-${gpu ? 'vulkan' : 'cpu'}`);
  if (brain) ids.push(KIT_BRAINS[tier].model, KIT_BRAINS[tier].mmproj);
  if (embeddings) ids.push('embeddinggemma2-q8');
  if (speech) ids.push(`whisper-${platform.os}`, 'whisper-base-q8');
  return {gpu, files: [...new Set(ids)].map(id => ({id, name: basename(new URL(FILES[id].url).pathname), ...FILES[id]}))};
}

async function freeBytes(folder) {
  let probe = resolve(folder);
  while (!existsSync(probe) && dirname(probe) !== probe) probe = dirname(probe);
  try { const s = await statfs(probe); return Number(s.bavail) * Number(s.bsize); } catch { return undefined; }
}
const sizeOf = path => { try { return statSync(path).size; } catch { return 0; } };
const hashFile = async (path, hash = createHash('sha256')) => { await pipeline(createReadStream(path), async source => { for await (const chunk of source) hash.update(chunk); }); return hash; };

/** Download one file with resume, cancellation and SHA-256 verification. Writes <dest>.part, renames when verified. */
export async function download(file, dest, {signal, onBytes = () => {}} = {}) {
  const part = dest + '.part';
  await mkdir(dirname(dest), {recursive: true});
  let start = sizeOf(part);
  if (start > file.size) { await truncate(part, 0); start = 0; }
  let hash = createHash('sha256');
  if (start > 0) { await hashFile(part, hash); onBytes(start); }
  if (start < file.size) {
    const response = await fetch(file.url, {headers: start ? {range: `bytes=${start}-`} : {}, signal, redirect: 'follow'});
    if (start && response.status !== 206) { await truncate(part, 0); onBytes(-start); start = 0; hash = createHash('sha256'); }
    if (!response.ok) throw Error(`${file.name}: the download server answered HTTP ${response.status}.`);
    const counter = new Transform({transform(chunk, _enc, done) { hash.update(chunk); onBytes(chunk.length); done(null, chunk); }});
    await pipeline(Readable.fromWeb(response.body), counter, createWriteStream(part, {flags: start ? 'a' : 'w'}), {signal});
  }
  if (sizeOf(part) !== file.size) throw Error(`${file.name}: the download is incomplete; start again to resume.`);
  const digest = hash.digest('hex');
  if (digest !== file.sha256) {
    await rename(part, part + '.bad');
    throw Error(`${file.name}: the checksum does not match the publisher's, so the file was set aside (${basename(part)}.bad).`);
  }
  await rename(part, dest);
}

const run = (command, args, options = {}) => new Promise((done, fail) => {
  const child = spawn(command, args, {windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'], ...options});
  let err = ''; child.stderr?.on('data', c => { err += c; });
  child.on('error', fail); child.on('exit', code => code === 0 ? done() : fail(Error(`${basename(command)} failed: ${err.slice(-300)}`)));
});
function findFile(dir, names) {
  for (const entry of readdirSync(dir, {withFileTypes: true})) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) { const hit = findFile(path, names); if (hit) return hit; }
    else if (names.includes(entry.name)) return path;
  }
}
const exe = name => process.platform === 'win32' ? `${name}.exe` : name;

async function answers(url, timeout = 1500) {
  try { const r = await fetch(url, {signal: AbortSignal.timeout(timeout)}); return r.status; } catch { return 0; }
}

export class Kit {
  constructor({home, logger, wire}) {
    this.home = home; this.logger = logger; this.wire = wire;
    this.job = {state: 'idle'}; this.servers = new Map(); this.manifest = undefined; this.folder = undefined;
  }

  async readManifest(folder) {
    try { return JSON.parse(await readFile(join(folder, MANIFEST), 'utf8')); } catch { return undefined; }
  }

  /** What "Set me up" would download, its size, what is already there, and whether the disk has room. */
  async plan({tier = '8gb', folder, speech = false, brain = true, embeddings = true} = {}) {
    folder = resolve(folder || defaultKitFolder());
    if (!isAbsolute(folder)) throw Error('Choose a full folder path.');
    const platform = platformInfo();
    const {gpu, files} = kitFiles({tier, speech, brain, embeddings}, platform);
    const rows = files.map(f => {
      const dest = join(folder, f.unpack ? 'downloads' : 'models', f.name);
      const have = sizeOf(dest) === f.size ? f.size : Math.min(sizeOf(dest + '.part'), f.size);
      return {id: f.id, name: f.name, size: f.size, have, licence: f.licence, source: new URL(f.url).hostname};
    });
    const total = rows.reduce((n, f) => n + f.size, 0), remaining = rows.reduce((n, f) => n + f.size - f.have, 0);
    // Unpacked server binaries take roughly three times their archive size.
    const unpacked = files.filter(f => f.unpack).reduce((n, f) => n + f.size * 3, 0);
    const needed = remaining + unpacked + 200 * MB;
    const free = await freeBytes(folder);
    return {folder, tier, tierLabel: TIERS.find(t => t.id === tier)?.label, platform: platform.label, gpu,
      files: rows, total, remaining, needed, free, enough: free === undefined || free >= needed};
  }

  /** Start downloading and installing in the background; poll summary() for progress. */
  async start(options = {}) {
    if (['downloading', 'verifying', 'unpacking', 'starting'].includes(this.job.state)) throw Error('A setup is already running.');
    const plan = await this.plan(options);
    if (!plan.enough) throw Error(`Not enough free space in ${plan.folder}: it needs ${(plan.needed / 1e9).toFixed(1)} GB and has ${(plan.free / 1e9).toFixed(1)} GB.`);
    this.abort = new AbortController();
    this.folder = plan.folder;
    this.job = {state: 'downloading', message: 'Starting…', tier: plan.tier, done: 0, total: plan.total, files: plan.files.map(f => ({...f, done: f.have}))};
    void this.#install(plan, options).catch(error => {
      const cancelled = this.abort?.signal.aborted;
      this.job = {...this.job, state: cancelled ? 'cancelled' : 'failed', message: cancelled ? 'Cancelled. Start again to resume where it stopped.' : error.message};
    });
    return {...this.summary(), folder: plan.folder};
  }

  cancel() { this.abort?.abort(); }

  async #install(plan, options) {
    const {folder} = plan, signal = this.abort.signal;
    const {files} = kitFiles({tier: plan.tier, speech: options.speech === true, brain: options.brain !== false, embeddings: options.embeddings !== false});
    this.job.done = plan.files.reduce((n, f) => n + f.have, 0);
    for (const file of files) {
      const row = this.job.files.find(f => f.id === file.id);
      const dest = join(folder, file.unpack ? 'downloads' : 'models', file.name);
      if (sizeOf(dest) === file.size) {
        this.job.message = `Checking ${file.name}…`; this.job.state = 'verifying';
        if ((await hashFile(dest)).digest('hex') === file.sha256) { row.done = file.size; continue; }
        await rename(dest, dest + '.part');   // the same size but different content: download it again
        await truncate(dest + '.part', 0); this.job.done -= file.size; row.done = 0;
      }
      this.job.state = 'downloading'; this.job.message = `Downloading ${file.name}`; this.job.current = file.id;
      const before = row.done;
      this.job.done -= before; row.done = 0;
      await download(file, dest, {signal, onBytes: n => { row.done += n; this.job.done += n; }});
    }
    this.job.state = 'unpacking'; this.job.message = 'Unpacking the servers…'; this.job.current = undefined;
    const bin = {};
    for (const file of files.filter(f => f.unpack)) {
      const target = join(folder, 'bin', file.name.replace(/\.(zip|tar\.gz)$/, ''));
      const server = exe(file.unpack === 'llama' ? 'llama-server' : 'whisper-server');
      let found = existsSync(target) ? findFile(target, [server]) : undefined;
      if (!found) {
        await mkdir(target, {recursive: true});
        // Windows: its own bsdtar (System32), which reads zip; a GNU tar earlier on PATH (Git, MSYS) cannot.
        const tar = process.platform === 'win32' ? join(process.env.SystemRoot || 'C:\Windows', 'System32', 'tar.exe') : 'tar';
        await run(tar, ['-xf', join(folder, 'downloads', file.name), '-C', target]);
        found = findFile(target, [server]);
      }
      if (!found) throw Error(`${file.name} does not contain ${server}.`);
      if (process.platform !== 'win32') chmodSync(found, 0o755);
      bin[file.unpack] = found;
    }
    const model = id => join(folder, 'models', FILES[id].url.split('/').pop());
    const brain = KIT_BRAINS[plan.tier];
    const servers = {};
    if (options.brain !== false) servers.brain = {binary: bin.llama, port: KIT_PORTS.brain, model: brain.name, vision: true, contextWindow: brain.context,
      args: ['-m', model(brain.model), '--mmproj', model(brain.mmproj), '--jinja', '-c', String(brain.context), '-ngl', plan.gpu ? '99' : '0',
        '-fa', 'on', '-ctk', 'q8_0', '-ctv', 'q8_0', '--alias', brain.name]};
    if (options.embeddings !== false) servers.embeddings = {binary: bin.llama, port: KIT_PORTS.embeddings, model: 'embeddinggemma-2',
      args: ['-m', model('embeddinggemma2-q8'), '--embeddings', '-c', '2048', '-b', '2048', '-ub', '2048', '-ngl', '0', '--alias', 'embeddinggemma-2']};
    if (options.speech === true) servers.stt = {binary: bin.whisper, port: KIT_PORTS.stt, model: 'whisper-1', kind: 'whisper',
      args: ['-m', model('whisper-base-q8'), '--inference-path', '/v1/audio/transcriptions', '-t', '4']};
    const manifest = {version: 1, tier: plan.tier, createdAt: new Date().toISOString(), servers};
    const previous = await this.readManifest(folder);
    if (previous?.servers) for (const [id, s] of Object.entries(previous.servers)) manifest.servers[id] ??= s;   // keep roles installed earlier
    await writeFile(join(folder, MANIFEST), JSON.stringify(manifest, null, 2));
    this.manifest = manifest;
    if (options.startServers === false) { this.job.state = 'done'; this.job.message = 'Downloaded and verified. Atelier starts the servers when it starts.'; return; }
    this.job.state = 'starting'; this.job.message = 'Starting the local servers…';
    await this.startServers(true);
    const failed = [...this.servers].filter(([, s]) => s.state === 'failed');
    this.job.state = failed.length ? 'failed' : 'done';
    this.job.message = failed.length ? `Downloaded, but ${failed.map(([id]) => id).join(', ')} did not start: ${failed[0][1].message}` : 'Done. The roles are connected.';
  }

  /** On Atelier start: bring back the kit's servers if one was installed and not stopped. */
  async resume(saved = {}) {
    if (saved.autostart === false) return;
    const folder = saved.folder || defaultKitFolder();
    const manifest = await this.readManifest(folder);
    if (!manifest) return;
    this.folder = folder; this.manifest = manifest;
    await this.startServers(false);
  }

  endpointFor(id) {
    const s = this.manifest?.servers?.[id];
    return s ? {baseURL: `http://127.0.0.1:${s.port}/v1`, model: s.model, vision: s.vision === true, contextWindow: s.contextWindow, preset: 'kit'} : undefined;
  }

  async startServers(force) {
    const ready = {};
    await Promise.all(Object.entries(this.manifest?.servers ?? {}).map(async ([id, s]) => {
      const health = `http://127.0.0.1:${s.port}${s.kind === 'whisper' ? '/' : '/health'}`;
      const known = this.servers.get(id);
      if (known?.child && known.state !== 'failed') { ready[id] = this.endpointFor(id); return; }
      if (await answers(health) === 200) { this.servers.set(id, {state: 'running', port: s.port, message: 'Already running.'}); ready[id] = this.endpointFor(id); return; }
      if (!existsSync(s.binary)) { this.servers.set(id, {state: 'failed', port: s.port, message: 'The server program is missing; run "Set me up" again.'}); return; }
      await mkdir(join(this.folder, 'logs'), {recursive: true});
      const log = openSync(join(this.folder, 'logs', `${id}.log`), 'a');
      let child;
      try {
        child = spawn(s.binary, [...s.args, '--host', '127.0.0.1', '--port', String(s.port)], {
          windowsHide: true, stdio: ['ignore', log, log], cwd: dirname(s.binary),
          env: {...process.env, LD_LIBRARY_PATH: [dirname(s.binary), process.env.LD_LIBRARY_PATH].filter(Boolean).join(':')}});
      } catch (error) {
        this.servers.set(id, {state: 'failed', port: s.port, message: `The server program could not start (${error.code ?? error.message}). Run "Set me up" again.`});
        return;
      } finally { closeSync(log); }
      const entry = {state: 'starting', port: s.port, pid: child.pid, child, message: 'Loading the model…'};
      this.servers.set(id, entry);
      child.on('exit', code => { if (entry.state !== 'stopped') Object.assign(entry, {state: 'failed', child: undefined, message: `Stopped (exit code ${code}). See logs/${id}.log in the kit folder.`}); });
      child.on('error', error => Object.assign(entry, {state: 'failed', child: undefined, message: error.message}));
      for (let waited = 0; waited < 300_000 && entry.state === 'starting'; waited += 1000) {
        if (await answers(health) === 200) { entry.state = 'running'; entry.message = 'Running.'; break; }
        await new Promise(r => setTimeout(r, 1000));
      }
      if (entry.state === 'starting') { entry.state = 'failed'; entry.message = 'Did not become ready within five minutes.'; }
      if (entry.state === 'running') ready[id] = this.endpointFor(id);
    }));
    if (Object.keys(ready).length) await this.wire(ready, force);
  }

  async stopServers() {
    for (const entry of this.servers.values()) {
      if (entry.child) { entry.state = 'stopped'; entry.message = 'Stopped.'; entry.child.kill(); entry.child = undefined; }
    }
  }

  dispose() { this.abort?.abort(); void this.stopServers(); }

  summary() {
    const servers = Object.fromEntries([...this.servers].map(([id, s]) => [id, {state: s.state, port: s.port, message: s.message}]));
    const {files, ...job} = this.job;
    return {job: {...job, files: files?.map(({id, name, size, done}) => ({id, name, size, done}))}, folder: this.folder,
      installed: this.manifest ? {tier: this.manifest.tier, roles: Object.keys(this.manifest.servers ?? {})} : undefined, servers};
  }
}
