// Atelier Brains, shared core. One small module used by the private harness and by the public release.
//
// A "brain" is the model server a computer runs on one graphics card. This module
//   - validates brains.json (the ONLY place that says what may be started or stopped, and how),
//   - builds the exact command for each allowed action (never a free-form command from the browser),
//   - runs load / unload / reload one at a time per computer, with a visible state, a timeout and the last log lines,
//   - answers "what is loaded right now" from a live provider (the real server, never a label).
//
// Hard rules kept here: the browser sends only {machine, brainId}; every command comes from brains.json and is built
// from a closed set of action types with validated parameters; nothing opens a window (hidden launches only); a process
// is only ever stopped by the exact PID that owns the brain's listening port; two actions never overlap on one computer.
import {execFile, spawn} from 'node:child_process';
import {appendFileSync, closeSync, openSync, readFileSync, statSync} from 'node:fs';

export const SCHEMA_VERSION = 1;
export const ACTION_TYPES = Object.freeze(['schtask-run', 'schtask-end', 'kill-port', 'systemd', 'spawn']);
export const KINDS = Object.freeze(['load', 'unload', 'reload']);

const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const TASK_RE = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,79}$/;
const UNIT_RE = /^[A-Za-z0-9@._-]{1,80}\.(service|timer)$/;
const HOST_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const PATH_RE = /^[A-Za-z0-9_:/\\ .()-]{1,260}$/;
const SOURCE_RE = /^[a-z0-9-]{1,40}$/;
const text = (v, max = 80) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const isPort = v => Number.isInteger(v) && v >= 1 && v <= 65535;
const safePath = v => typeof v === 'string' && PATH_RE.test(v) && !v.split(/[\\/]/u).includes('..');

/** Check one action. Pure. Pushes friendly sentences into `errors`. */
function checkAction(action, where, machine, errors) {
  if (!action || typeof action !== 'object' || Array.isArray(action)) { errors.push(`${where}: must be an object like {"type":"kill-port","port":8080}.`); return null; }
  const out = {type: action.type};
  if (!ACTION_TYPES.includes(action.type)) { errors.push(`${where}.type: "${String(action.type).slice(0, 30)}" is not allowed. Use one of ${ACTION_TYPES.join(', ')}.`); return null; }
  const windows = machine.transport.os === 'windows';
  if (action.type === 'schtask-run' || action.type === 'schtask-end') {
    if (!windows) errors.push(`${where}: ${action.type} only works on Windows computers.`);
    if (typeof action.task !== 'string' || !TASK_RE.test(action.task)) errors.push(`${where}.task: needs a scheduled task name (letters, numbers, spaces, . _ -).`);
    out.task = action.task;
  } else if (action.type === 'kill-port') {
    if (!isPort(action.port)) errors.push(`${where}.port: needs a port number from 1 to 65535.`);
    out.port = action.port;
  } else if (action.type === 'systemd') {
    if (windows) errors.push(`${where}: systemd only works on Linux computers.`);
    if (typeof action.unit !== 'string' || !UNIT_RE.test(action.unit)) errors.push(`${where}.unit: needs a unit name ending in .service or .timer.`);
    if (!['start', 'stop', 'restart'].includes(action.verb)) errors.push(`${where}.verb: use start, stop or restart.`);
    out.unit = action.unit; out.verb = action.verb; out.sudo = action.sudo === true;
  } else if (action.type === 'spawn') {
    if (machine.transport.type !== 'local') errors.push(`${where}: spawn can only start programs on this same computer. Use a scheduled task or a systemd unit for another computer.`);
    if (!safePath(action.file)) errors.push(`${where}.file: needs the full path to the program.`);
    if (!Array.isArray(action.args) || action.args.length > 60 || action.args.some(a => typeof a !== 'string' || a.length > 300 || /[\0\r\n]/u.test(a))) errors.push(`${where}.args: needs a list of text arguments.`);
    if (action.cwd !== undefined && !safePath(action.cwd)) errors.push(`${where}.cwd: needs a folder path.`);
    out.file = action.file; out.args = Array.isArray(action.args) ? action.args : []; if (action.cwd) out.cwd = action.cwd;
  }
  return out;
}

/**
 * Validate and normalise the parsed brains.json. Pure.
 * @returns {{ok: boolean, errors: string[], config: object|null}}
 */
export function validateConfig(raw) {
  const errors = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {ok: false, errors: ['brains.json must be a JSON object with a "machines" list.'], config: null};
  if (raw.version !== undefined && raw.version !== SCHEMA_VERSION) errors.push(`version: this Atelier reads version ${SCHEMA_VERSION}.`);
  if (!Array.isArray(raw.machines) || raw.machines.length === 0) errors.push('machines: needs at least one computer.');
  const machines = [], machineIds = new Set();
  for (const [mi, m] of (Array.isArray(raw.machines) ? raw.machines : []).entries()) {
    const mw = `machines[${mi}]`;
    if (!m || typeof m !== 'object') { errors.push(`${mw}: must be an object.`); continue; }
    if (typeof m.id !== 'string' || !ID_RE.test(m.id)) errors.push(`${mw}.id: use lowercase letters, numbers and dashes (for example "main-pc").`);
    else if (machineIds.has(m.id)) errors.push(`${mw}.id: "${m.id}" is used twice.`);
    else machineIds.add(m.id);
    if (!text(m.name, 60)) errors.push(`${mw}.name: needs a short friendly name.`);
    if (!text(m.gpu, 80)) errors.push(`${mw}.gpu: needs the graphics card name.`);
    if (!(typeof m.vramGb === 'number' && m.vramGb > 0 && m.vramGb <= 4096)) errors.push(`${mw}.vramGb: needs the card memory in GB.`);
    const control = m.control ?? 'full';
    if (!['full', 'view'].includes(control)) errors.push(`${mw}.control: use "full" or "view".`);
    const t = m.transport ?? {type: 'local'};
    if (!['local', 'ssh'].includes(t.type)) errors.push(`${mw}.transport.type: use "local" or "ssh".`);
    if (t.type === 'ssh' && (typeof t.host !== 'string' || !HOST_RE.test(t.host))) errors.push(`${mw}.transport.host: needs an ssh host name.`);
    const defaultOs = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux';
    const os = t.os ?? (t.type === 'local' ? defaultOs : undefined);
    if (!['windows', 'linux', 'macos'].includes(os)) errors.push(`${mw}.transport.os: use "windows", "linux" or "macos".`);
    if (m.gpuMatch !== undefined && !text(m.gpuMatch, 40)) errors.push(`${mw}.gpuMatch: needs a few characters of the card's name, such as "4070".`);
    if (m.liveSource !== undefined && (typeof m.liveSource !== 'string' || !SOURCE_RE.test(m.liveSource))) errors.push(`${mw}.liveSource: use lowercase letters, numbers and dashes.`);
    const machine = {id: m.id, name: m.name, gpu: m.gpu, vramGb: m.vramGb, control, exclusive: m.exclusive !== false,
      transport: {type: t.type, ...(t.host ? {host: t.host} : {}), os}, ...(m.liveSource ? {liveSource: m.liveSource} : {}), ...(m.gpuMatch ? {gpuMatch: m.gpuMatch} : {}), brains: []};
    if (!Array.isArray(m.brains) || m.brains.length === 0) errors.push(`${mw}.brains: needs at least one brain.`);
    const brainIds = new Set();
    for (const [bi, b] of (Array.isArray(m.brains) ? m.brains : []).entries()) {
      const bw = `${mw}.brains[${bi}]`;
      if (!b || typeof b !== 'object') { errors.push(`${bw}: must be an object.`); continue; }
      if (typeof b.id !== 'string' || !ID_RE.test(b.id)) errors.push(`${bw}.id: use lowercase letters, numbers and dashes.`);
      else if (brainIds.has(b.id)) errors.push(`${bw}.id: "${b.id}" is used twice on ${m.id}.`);
      else brainIds.add(b.id);
      if (!text(b.name, 80)) errors.push(`${bw}.name: needs a friendly name such as "Qwen3 14B".`);
      if (b.blurb !== undefined && !text(b.blurb, 120)) errors.push(`${bw}.blurb: needs a few friendly words such as "fast, 32K context".`);
      if (!text(b.engine, 30)) errors.push(`${bw}.engine: needs the engine name (llama.cpp, vLLM, Ollama...).`);
      if (!isPort(b.port)) errors.push(`${bw}.port: needs a port number from 1 to 65535.`);
      let healthUrl = b.healthUrl ?? (isPort(b.port) ? `http://127.0.0.1:${b.port}/v1/models` : undefined);
      try { const u = new URL(healthUrl); if (!/^https?:$/u.test(u.protocol)) throw Error('scheme'); } catch { errors.push(`${bw}.healthUrl: needs an http or https address.`); healthUrl = undefined; }
      if (b.metricsUrl !== undefined) { try { if (!/^https?:$/u.test(new URL(b.metricsUrl).protocol)) throw Error('scheme'); } catch { errors.push(`${bw}.metricsUrl: needs an http or https address.`); } }
      if (!(typeof b.vramGb === 'number' && b.vramGb > 0)) errors.push(`${bw}.vramGb: needs the memory this brain uses, in GB.`);
      else if (typeof m.vramGb === 'number' && b.vramGb > m.vramGb) errors.push(`${bw}.vramGb: ${b.vramGb} GB does not fit on a ${m.vramGb} GB card.`);
      const loadSec = b.loadTimeoutSec ?? 180, unloadSec = b.unloadTimeoutSec ?? 45;
      if (!(Number.isInteger(loadSec) && loadSec >= 10 && loadSec <= 1800)) errors.push(`${bw}.loadTimeoutSec: use 10 to 1800 seconds.`);
      if (!(Number.isInteger(unloadSec) && unloadSec >= 5 && unloadSec <= 600)) errors.push(`${bw}.unloadTimeoutSec: use 5 to 600 seconds.`);
      if (b.logFile !== undefined && !safePath(b.logFile)) errors.push(`${bw}.logFile: needs a plain file path.`);
      const actionsOf = key => {
        const list = b[key];
        if (list === undefined) return [];
        if (!Array.isArray(list) || list.length > 6) { errors.push(`${bw}.${key}: needs a short list of actions.`); return []; }
        return list.map((a, ai) => checkAction(a, `${bw}.${key}[${ai}]`, machine, errors)).filter(Boolean);
      };
      const start = actionsOf('start'), stop = actionsOf('stop');
      if (control === 'full' && start.length === 0) errors.push(`${bw}.start: a controllable computer needs a way to start this brain.`);
      if (control === 'full' && stop.length === 0) errors.push(`${bw}.stop: a controllable computer needs a way to stop this brain (for example a kill-port action).`);
      machine.brains.push({id: b.id, name: b.name, blurb: b.blurb ?? '', engine: b.engine, port: b.port, healthUrl, ...(b.metricsUrl ? {metricsUrl: b.metricsUrl} : {}),
        vramGb: b.vramGb, loadTimeoutSec: loadSec, unloadTimeoutSec: unloadSec, ...(b.logFile ? {logFile: b.logFile} : {}), start, stop});
    }
    machines.push(machine);
  }
  if (errors.length) return {ok: false, errors, config: null};
  return {ok: true, errors: [], config: {version: SCHEMA_VERSION, machines}};
}

/** Read and validate a brains.json file. Never throws. */
export function loadConfigFile(path, readText = p => readFileSync(p, 'utf8')) {
  let raw;
  try { raw = JSON.parse(readText(path)); }
  catch (error) { return {ok: false, errors: [error?.code === 'ENOENT' ? 'brains.json was not found.' : `brains.json could not be read: ${String(error?.message ?? error).slice(0, 120)}`], config: null, missing: error?.code === 'ENOENT'}; }
  return validateConfig(raw);
}

// ---- commands -----------------------------------------------------------------------------------------------------

const b64 = s => Buffer.from(s, 'utf8').toString('base64');
const b64Utf16 = s => Buffer.from(s, 'utf16le').toString('base64');
const PS_HEAD = "$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';";

function windowsScript(action) {
  if (action.type === 'schtask-run') return `${PS_HEAD}Start-ScheduledTask -TaskName '${action.task}';'started'`;
  if (action.type === 'schtask-end') return `${PS_HEAD}Stop-ScheduledTask -TaskName '${action.task}';'ended'`;
  if (action.type === 'kill-port') {
    // Only the process that owns the listening socket is stopped, by its exact PID (never 0 or 4).
    return `${PS_HEAD}$ids=@(Get-NetTCPConnection -State Listen -LocalPort ${action.port} -ErrorAction SilentlyContinue|Select-Object -ExpandProperty OwningProcess -Unique);`
      + `if($ids.Count -eq 0){'no-listener'}else{foreach($i in $ids){if($i -gt 4){Stop-Process -Id $i -Force;"killed $i"}}}`;
  }
  if (action.type === 'tail-log') return `$ProgressPreference='SilentlyContinue';Get-Content -LiteralPath '${action.path}' -Tail ${action.lines} -ErrorAction SilentlyContinue`;
  throw Error(`No Windows script for ${action.type}.`);
}
function posixScript(action) {
  if (action.type === 'systemd') return `${action.sudo ? 'sudo -n ' : ''}systemctl ${action.verb} ${action.unit} && echo ${action.verb}ed`;
  if (action.type === 'kill-port') {
    return `p=${action.port}; pids=$(lsof -t -nP -iTCP:$p -sTCP:LISTEN 2>/dev/null || ss -H -ltnp "sport = :$p" 2>/dev/null | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u); `
      + `if [ -z "$pids" ]; then echo no-listener; else for i in $pids; do [ "$i" -gt 1 ] && kill "$i" && echo "killed $i"; done; fi`;
  }
  if (action.type === 'tail-log') return `tail -n ${action.lines} -- '${action.path}' 2>/dev/null`;
  throw Error(`No script for ${action.type}.`);
}

/**
 * The exact process to run for one allowed action on one machine. Pure.
 * `spawn` actions return {spawn: {...}} (a detached hidden launch); everything else returns {file, args}.
 */
export function buildCommand(machine, action, timeoutMs = 20_000) {
  const os = machine.transport.os, t = machine.transport;
  if (action.type === 'spawn') return {spawn: {file: action.file, args: action.args, cwd: action.cwd ?? undefined, logFile: action.logFile ?? undefined}, timeoutMs};
  if (os === 'windows') {
    const enc = b64Utf16(windowsScript(action));
    if (t.type === 'local') return {file: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', enc], timeoutMs};
    return {file: 'ssh', args: ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=6', t.host, `powershell -NoProfile -NonInteractive -EncodedCommand ${enc}`], timeoutMs};
  }
  const script = posixScript(action);
  if (t.type === 'local') return {file: '/bin/sh', args: ['-c', script], timeoutMs};
  return {file: 'ssh', args: ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=6', t.host, `echo ${b64(script)} | base64 -d | sh`], timeoutMs};
}

/** Default process runner: hidden, bounded, never throws. */
export function defaultExec(cmd) {
  if (cmd.spawn) {
    return new Promise(resolve => {
      try {
        const out = cmd.spawn.logFile ? openSync(cmd.spawn.logFile, 'a') : 'ignore';
        const child = spawn(cmd.spawn.file, cmd.spawn.args, {detached: true, windowsHide: true, stdio: ['ignore', out, out], cwd: cmd.spawn.cwd});
        child.on('error', error => resolve({ok: false, code: -1, stdout: '', stderr: String(error.message).slice(0, 200)}));
        child.unref();
        if (typeof out === 'number') closeSync(out);
        setTimeout(() => resolve({ok: true, code: 0, stdout: `spawned ${child.pid ?? ''}`, stderr: ''}), 300);
      } catch (error) { resolve({ok: false, code: -1, stdout: '', stderr: String(error.message).slice(0, 200)}); }
    });
  }
  return new Promise(resolve => {
    execFile(cmd.file, cmd.args, {timeout: cmd.timeoutMs ?? 20_000, windowsHide: true, maxBuffer: 1 << 20}, (error, stdout, stderr) => {
      const clean = String(stdout ?? '').replace(/#< CLIXML[\s\S]*$/u, '').trim();
      resolve({ok: !error, code: error ? (typeof error.code === 'number' ? error.code : -1) : 0, stdout: clean, stderr: String(stderr ?? '').replace(/#< CLIXML[\s\S]*$/u, '').split(/\r?\n/u).filter(line => !line.startsWith('**')).join('\n').trim().slice(0, 400)});
    });
  });
}

// ---- live state ---------------------------------------------------------------------------------------------------

/** llama.cpp /metrics text -> the generation speed gauge, or null. Pure. */
export function parseTokensPerSecond(metricsText) {
  const m = /^llamacpp:predicted_tokens_seconds\s+([0-9.eE+-]+)/mu.exec(String(metricsText ?? ''));
  const v = m ? Number(m[1]) : NaN;
  return Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * Generic live provider: asks each brain's own server (healthUrl) whether it answers, and what model it reports.
 * The server is the truth; nothing here is a label.
 */
export function genericLive({fetchImpl = globalThis.fetch, timeoutMs = 1500} = {}) {
  return async machine => {
    const entries = await Promise.all(machine.brains.map(async brain => {
      try {
        const res = await fetchImpl(brain.healthUrl, {signal: AbortSignal.timeout(timeoutMs)});
        if (!res.ok) return [brain.id, {up: false}];
        const json = await res.json().catch(() => null);
        const modelName = json?.data?.[0]?.id ?? json?.models?.[0]?.name ?? json?.model ?? null;
        let tps = null;
        if (brain.metricsUrl) {
          try { tps = parseTokensPerSecond(await (await fetchImpl(brain.metricsUrl, {signal: AbortSignal.timeout(timeoutMs)})).text()); } catch { /* speed is optional */ }
        }
        return [brain.id, {up: true, modelName, tps}];
      } catch { return [brain.id, {up: false}]; }
    }));
    return Object.fromEntries(entries);
  };
}

// ---- manager ------------------------------------------------------------------------------------------------------

const LIVE_CACHE_MS = 1500;
const MASK_MS = 25_000;
const OP_KEEP_MS = 10 * 60_000;

/**
 * The state machine behind the buttons.
 * `live(machine)` -> {[brainId]: {up, modelName?, tps?, ctx?, busy?, loading?}} from the real servers.
 * `exec(command)` -> {ok, code, stdout, stderr}. Tests pass a fake for both and for `sleep`/`now`.
 */
export function createBrainManager({config, exec = defaultExec, live = genericLive(), sleep = ms => new Promise(r => setTimeout(r, ms)), now = Date.now,
  pollMs = 2000, settleMs = 20_000, audit = null} = {}) {
  let cfg = config;
  const machineOf = id => cfg.machines.find(m => m.id === id);
  const busy = new Map();       // machine id -> running op (the guard: one action per computer at a time)
  const lastOp = new Map();     // machine id -> last finished op, kept OP_KEEP_MS
  const masks = new Map();      // "machine/brain" -> until: a stopped brain shows as unloaded before the server's own signal catches up
  const liveCache = new Map();  // machine id -> {at, value, error}
  const running = new Set();
  let seq = 0;

  const maskKey = (m, b) => `${m}/${b}`;
  async function readLive(machine, fresh = false) {
    const hit = liveCache.get(machine.id);
    if (!fresh && hit && now() - hit.at < LIVE_CACHE_MS) return hit;
    let entry;
    try { entry = {at: now(), value: (await live(machine)) ?? {}, error: null}; }
    catch (error) { entry = {at: now(), value: {}, error: String(error?.message ?? error).slice(0, 120)}; }
    liveCache.set(machine.id, entry);
    return entry;
  }
  const isUp = (machine, brainId, l) => {
    const until = masks.get(maskKey(machine.id, brainId));
    if (until !== undefined && now() < until) return false;
    return l.value[brainId]?.up === true;
  };

  async function machineView(machine) {
    const l = await readLive(machine);
    const op = busy.get(machine.id) ?? lastOp.get(machine.id) ?? null;
    const brains = machine.brains.map(b => {
      const v = l.value[b.id] ?? {};
      const up = isUp(machine, b.id, l);
      return {id: b.id, name: b.name, blurb: b.blurb, engine: b.engine, vramGb: b.vramGb, loaded: up, loadSeconds: b.loadTimeoutSec,
        ...(up ? {modelName: v.modelName ?? null, tps: v.tps ?? null, ctx: v.ctx ?? null, busy: v.busy === true} : {})};
    });
    const loadedBrains = brains.filter(b => b.loaded);
    const loaded = loadedBrains[0] ?? null;
    const loadingByServer = machine.brains.some(b => l.value[b.id]?.loading === true);
    const checking = l.value._checking === true;
    let state;
    if (op?.running) state = op.kind === 'unload' ? 'unloading' : 'loading';
    else if (loaded) state = 'loaded';
    else if (loadingByServer) state = 'loading';
    else if (checking) state = 'checking';
    else if (l.error) state = 'unknown';
    else if (op && op.ok === false) state = 'failed';
    else state = 'empty';
    return {id: machine.id, name: machine.name, gpu: machine.gpu, gpuMatch: machine.gpuMatch ?? null, vramGb: machine.vramGb, control: machine.control, state,
      loaded: loaded ? {brainId: loaded.id, name: loaded.name, blurb: loaded.blurb, modelName: loaded.modelName, tps: loaded.tps, ctx: loaded.ctx, busy: loaded.busy} : null,
      conflict: loadedBrains.length > 1, brains, error: l.error, at: l.at,
      op: op ? {id: op.id, kind: op.kind, brainId: op.brainId, phase: op.phase, message: op.message, running: op.running === true, ok: op.ok ?? null,
        startedAt: op.startedAt, finishedAt: op.finishedAt ?? null, logTail: op.logTail ?? null} : null};
  }

  async function status() {
    for (const [id, op] of lastOp) if (now() - (op.finishedAt ?? 0) > OP_KEEP_MS) lastOp.delete(id);
    const machines = await Promise.all(cfg.machines.map(machineView));
    return {ok: true, at: now(), machines};
  }

  const fail = (statusCode, error) => ({ok: false, status: statusCode, error});

  /** Start a load, unload or reload. Returns at once; the work continues in the background. */
  function act(kind, {machine: machineId, brainId, by = ''} = {}) {
    if (!KINDS.includes(kind)) return fail(400, 'Unknown action.');
    const machine = typeof machineId === 'string' ? machineOf(machineId) : undefined;
    if (!machine) return fail(404, 'That computer is not in the brains list.');
    if (machine.control !== 'full') return fail(403, `${machine.name} is view only here. Its brain is managed elsewhere, so Atelier only shows what is loaded.`);
    const brain = typeof brainId === 'string' ? machine.brains.find(b => b.id === brainId) : undefined;
    if (!brain) return fail(404, 'That brain is not in the list for this computer.');
    const current = busy.get(machine.id);
    if (current) return fail(409, `${machine.name} is busy: ${current.message} Wait for it to finish.`);
    const op = {id: `op-${now().toString(36)}-${++seq}`, kind, machineId: machine.id, brainId: brain.id, phase: 'queued', running: true, ok: null, startedAt: now(), message: 'Starting…', by: String(by).slice(0, 40)};
    busy.set(machine.id, op);
    const job = runOp(machine, brain, op)
      .catch(error => finish(machine, op, false, `Something went wrong: ${String(error?.message ?? error).slice(0, 160)}`))
      .finally(() => running.delete(job));
    running.add(job);
    return {ok: true, status: 202, op: {id: op.id, kind, machine: machine.id, brainId: brain.id}};
  }

  function finish(machine, op, ok, message, logTail = null) {
    op.running = false; op.ok = ok; op.phase = ok ? 'done' : 'failed'; op.message = message; op.finishedAt = now(); op.logTail = logTail;
    if (busy.get(machine.id) === op) busy.delete(machine.id);
    lastOp.set(machine.id, op);
    try { audit?.({at: new Date(now()).toISOString(), machine: machine.id, brain: op.brainId, kind: op.kind, ok, message, by: op.by}); } catch { /* the audit line is best effort */ }
  }

  async function runActions(machine, brain, actions) {
    for (const action of actions) {
      const res = await exec(buildCommand(machine, action.type === 'spawn' ? {...action, logFile: brain.logFile} : action));
      if (!res.ok) return {ok: false, detail: (res.stderr || res.stdout || `exit ${res.code}`).slice(0, 200)};
    }
    return {ok: true};
  }

  async function logTailOf(machine, brain) {
    if (!brain.logFile) return null;
    try {
      const res = await exec(buildCommand(machine, {type: 'tail-log', path: brain.logFile, lines: 12}, 12_000));
      const lines = String(res.stdout ?? '').split(/\r?\n/u).filter(Boolean).slice(-12);
      return lines.length ? lines.join('\n') : null;
    } catch { return null; }
  }

  async function waitFor(machine, ids, wantUp, seconds, op, label) {
    const started = now();
    for (;;) {
      const l = await readLive(machine, true);
      if (ids.every(id => (l.value[id]?.up === true) === wantUp)) return true;
      if (now() - started >= seconds * 1000) return false;
      op.message = `${label} ${Math.round((now() - started) / 1000)} s`;
      await sleep(pollMs);
    }
  }

  async function runOp(machine, brain, op) {
    const first = await readLive(machine, true);
    const upNow = machine.brains.filter(b => first.value[b.id]?.up === true).map(b => b.id);
    if (op.kind === 'load' && upNow.length === 1 && upNow[0] === brain.id) return finish(machine, op, true, `${brain.name} is already loaded.`);
    // 1. make room: on an exclusive card everything else is stopped (the stop actions are safe when nothing runs); an unload stops just this brain
    const stopList = (op.kind === 'unload' ? [brain] : machine.exclusive ? machine.brains.filter(b => b.id !== brain.id || op.kind === 'reload') : (op.kind === 'reload' ? [brain] : []))
      .filter(b => b.stop.length > 0);
    if (stopList.length) {
      op.phase = 'making-room';
      op.message = op.kind === 'unload' ? `Unloading ${brain.name}…` : (upNow.some(id => id !== brain.id) ? `Making room on ${machine.gpu}…` : `Getting ${machine.name} ready…`);
      for (const b of stopList) {
        const r = await runActions(machine, b, b.stop);
        if (!r.ok) return finish(machine, op, false, `Could not stop ${b.name}: ${r.detail}`);
        masks.set(maskKey(machine.id, b.id), now() + MASK_MS);
      }
      await waitFor(machine, stopList.map(b => b.id), false, Math.round(settleMs / 1000), op, 'Waiting for the memory to be freed');
    }
    if (op.kind === 'unload') return finish(machine, op, true, `${brain.name} is unloaded. ${machine.name} is free.`);
    // 2. start the wanted brain
    op.phase = 'starting'; op.message = `Starting ${brain.name}…`;
    masks.delete(maskKey(machine.id, brain.id));
    const started = await runActions(machine, brain, brain.start);
    if (!started.ok) return finish(machine, op, false, `Could not start ${brain.name}: ${started.detail}`, await logTailOf(machine, brain));
    // 3. wait until the real server answers
    op.phase = 'waiting'; op.message = `Loading ${brain.name}…`;
    const ready = await waitFor(machine, [brain.id], true, brain.loadTimeoutSec, op, `Loading ${brain.name}…`);
    if (!ready) return finish(machine, op, false, `${brain.name} did not become ready within ${brain.loadTimeoutSec} s.`, await logTailOf(machine, brain));
    return finish(machine, op, true, `${brain.name} is loaded.`);
  }

  return {status, act, machineOf, whenIdle: () => Promise.all([...running]), setConfig: next => { cfg = next; }, get config() { return cfg; }};
}

// ---- HTTP ---------------------------------------------------------------------------------------------------------

export const ROUTE = '/api/atelier-brains';
export const WRITE_HEADER = 'x-atelier-brains';

function readBody(req, limit = 4096) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', chunk => { size += chunk.length; if (size > limit) { req.destroy(); reject(Object.assign(Error('too large'), {status: 413})); return; } chunks.push(chunk); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * Request handler for GET /api/atelier-brains and POST /api/atelier-brains/{load|unload|reload}.
 * `getManager()` returns {manager} (maybe with errors) or {errors, missing} when brains.json is missing or wrong.
 */
export function createBrainsHandler({authorizeIndex, getManager, route = ROUTE}) {
  const send = (res, code, body) => {
    res.writeHead(code, {'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff'});
    res.end(JSON.stringify(body));
  };
  return async (req, res) => {
    if (!authorizeIndex(req, res)) return;
    const path = String(req.url ?? '').split('?')[0].replace(/\/+$/u, '');
    if (path !== route && !path.startsWith(`${route}/`)) { res.writeHead(404); res.end(); return; }
    const sub = path.slice(route.length).replace(/^\//u, '');
    const got = getManager();
    if (!got.manager) return send(res, 200, {ok: true, configured: false, missing: got.missing === true, errors: got.errors ?? [], where: got.path ?? null, machines: []});
    const {manager} = got;
    if (req.method === 'GET' && sub === '') return send(res, 200, {...(await manager.status()), configured: true, ...(got.errors?.length ? {errors: got.errors} : {})});
    if (req.method !== 'POST' || !KINDS.includes(sub)) { res.writeHead(405, {allow: 'GET, POST'}); res.end(); return; }
    if (req.headers[WRITE_HEADER] !== '1' || req.headers['sec-fetch-site'] === 'cross-site') return send(res, 403, {ok: false, error: 'Brain changes come from the Atelier page only.'});
    let body;
    try { body = JSON.parse(await readBody(req)); } catch (error) { return send(res, error?.status === 413 ? 413 : 400, {ok: false, error: 'Send JSON like {"machine":"...","brainId":"..."}.'}); }
    const by = String(req.headers['x-atelier-device'] ?? '').replace(/[^\w-]/gu, '').slice(0, 12);
    const result = manager.act(sub, {machine: body?.machine, brainId: body?.brainId, by});
    if (!result.ok) return send(res, result.status, {ok: false, error: result.error});
    return send(res, 202, {ok: true, op: result.op, ...(await manager.status()), configured: true});
  };
}

/**
 * Keeps a manager in step with brains.json: re-reads the file when it changes, so editing the file never needs a restart.
 * Returns getManager() for createBrainsHandler.
 */
export function configuredManager({path, live, exec, auditFile = null, statImpl = p => { try { return statSync(p).mtimeMs; } catch { return -1; } }}) {
  let manager = null, mtime = -2, problem = {errors: [], missing: false};
  const audit = auditFile ? entry => appendFileSync(auditFile, `${JSON.stringify(entry)}\n`) : null;
  return () => {
    const m = statImpl(path);
    if (m !== mtime) {
      mtime = m;
      const loaded = loadConfigFile(path);
      if (loaded.ok) {
        if (manager) manager.setConfig(loaded.config); else manager = createBrainManager({config: loaded.config, live, exec, audit});
        problem = {errors: [], missing: false};
      } else problem = {errors: loaded.errors, missing: loaded.missing === true};
    }
    if (manager) return problem.errors.length ? {manager, errors: problem.errors, path} : {manager, path};
    return {errors: problem.errors, missing: problem.missing, path};
  };
}
