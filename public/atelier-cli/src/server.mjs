// The engine the terminal talks to is the web app's own server (DSH `web` profile, started by start-preview.mjs).
// The terminal is a client of it, exactly like the browser: same sessions, presets, roles, canvas and IngeTrazo
// tools, and a chat started in one is live in the other. Nothing here writes session files itself.
//
// Finding a server for this Atelier home, in order:
//   <home>/run/url.json                  written by the desktop launchers (Windows tray app, Linux atelier-preview)
//   <home>/run/atelier-cli-server.json   written by `atelier web` and by servers the terminal started
// If none answers, the terminal starts one in the background (no window) and stops it again when it exits.
import {randomBytes} from 'node:crypto';
import {spawn, spawnSync} from 'node:child_process';
import {closeSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {createConnection, createServer} from 'node:net';
import {join} from 'node:path';
import {START_PREVIEW} from './paths.mjs';

export const runDir = home => join(home, 'run');
export const cliServerRecord = home => join(runDir(home), 'atelier-cli-server.json');
const launcherRecord = home => join(runDir(home), 'url.json');
const readJson = path => { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return undefined; } };

const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const answers = (host, port, timeoutMs = 700) => new Promise(done => {
  const socket = createConnection({host, port});
  socket.setTimeout(timeoutMs, () => { socket.destroy(); done(false); });
  socket.once('connect', () => { socket.destroy(); done(true); });
  socket.once('error', () => done(false));
});
const bindable = (host, port) => new Promise(done => {
  const server = createServer();
  server.once('error', error => done(error.code === 'EADDRNOTAVAIL' || error.code === 'EAFNOSUPPORT'));
  server.listen({host, port, exclusive: true}, () => server.close(() => done(true)));
});
export const portFree = async port => !(await answers('127.0.0.1', port)) && !(await answers('::1', port))
  && await bindable('127.0.0.1', port) && await bindable('::1', port);

export async function pickPort(preferred) {
  if (preferred) {
    if (await portFree(preferred)) return preferred;
    throw Object.assign(Error(`Port ${preferred} is already in use. Close that program, or choose another port with --port.`), {exitCode: 3});
  }
  for (let port = 3081; port < 3100; port++) if (await portFree(port)) return port;
  throw Object.assign(Error('Ports 3081 to 3099 are all in use. Choose a free port with --port.'), {exitCode: 3});
}

/** A server recorded for this home that still answers: {port, token, pid, source, ownedByCli}. */
export async function findServer(home) {
  const launcher = readJson(launcherRecord(home));
  if (launcher?.url && launcher.port) {
    const token = new URL(launcher.url).searchParams.get('token');
    if (token && (!launcher.pid || alive(launcher.pid)) && await answers('localhost', launcher.port)) {
      return {port: launcher.port, token, pid: launcher.serverPid ?? launcher.pid, source: 'desktop launcher', ownedByCli: false};
    }
  }
  const cli = readJson(cliServerRecord(home));
  if (cli?.port && cli.token && cli.pid && alive(cli.pid) && await answers('localhost', cli.port)) {
    return {...cli, source: cli.source ?? 'atelier web', ownedByCli: false};
  }
  return undefined;
}

export const newLaunchToken = () => randomBytes(32).toString('base64url');

/**
 * Start the web app's server in the background for this home: no window, output to <home>/logs. Resolves once it
 * accepts the login token.
 */
export async function startServer(home, {port, env = process.env, timeoutMs = 180000, onProgress} = {}) {
  port = await pickPort(port);
  const token = newLaunchToken();
  mkdirSync(join(home, 'logs'), {recursive: true});
  mkdirSync(runDir(home), {recursive: true, mode: 0o700});
  const log = join(home, 'logs', `atelier-cli-server-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
  const out = openSync(log, 'a');
  const child = spawn(process.execPath, [START_PREVIEW], {
    cwd: join(START_PREVIEW, '..'), detached: process.platform !== 'win32', windowsHide: true,
    stdio: ['ignore', out, out],
    env: {...env, ATELIER_HOME: home, ATELIER_PORT: String(port), DSH_BROWSER_LAUNCH_TOKEN: token},
  });
  closeSync(out);
  let exited = null;
  child.once('exit', code => { exited = code ?? 1; });
  child.unref();
  const record = {port, token, pid: child.pid, log, source: 'started by the terminal', startedAt: new Date().toISOString()};
  writeFileSync(cliServerRecord(home), JSON.stringify(record), {mode: 0o600});
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (exited !== null) {
      rmSync(cliServerRecord(home), {force: true});
      const tail = readFileSync(log, 'utf8').trim().split('\n').slice(-12).join('\n');
      throw Object.assign(Error(`Atelier's web app stopped while starting (exit code ${exited}). The end of its log (${log}):\n${tail}`), {exitCode: 4});
    }
    if (await answers('localhost', port, 400)) {
      try { await login(port, token); return {...record, ownedByCli: true}; } catch { /* still booting */ }
    }
    onProgress?.();
    await new Promise(r => setTimeout(r, 400));
  }
  stopServer({...record, ownedByCli: true}, home);
  throw Object.assign(Error(`Atelier's web app did not start within ${Math.round(timeoutMs / 1000)} s. See ${log}`), {exitCode: 4});
}

/** Stop a server this terminal started: its exact process and the children it spawned, nothing else. */
export function stopServer(server, home) {
  if (!server?.ownedByCli || !server.pid) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], {windowsHide: true, stdio: 'ignore'});
  else { try { process.kill(-server.pid, 'SIGTERM'); } catch { try { process.kill(server.pid, 'SIGTERM'); } catch { /* gone */ } } }
  const record = readJson(cliServerRecord(home));
  if (record?.pid === server.pid) rmSync(cliServerRecord(home), {force: true});
}

/** Exchange the launch token for the session cookie, as the browser does on its first visit. */
export async function login(port, token) {
  const response = await fetch(`http://localhost:${port}/?token=${encodeURIComponent(token)}`, {redirect: 'manual', signal: AbortSignal.timeout(5000)});
  const cookie = response.headers.get('set-cookie');
  if (response.status !== 303 || !cookie) throw Error(`Atelier on port ${port} refused the login token (HTTP ${response.status}).`);
  return cookie.split(';')[0];
}

let rpcCounter = 0;

/** A logged-in client of one server: unary calls, live streams, the session export download. */
export class AtelierClient {
  constructor(port, cookie) {
    this.port = port; this.cookie = cookie; this.base = `http://localhost:${port}`;
    this.socket = undefined; this.streams = new Map(); this.opening = undefined;
  }

  static async connect(server) {
    return new AtelierClient(server.port, await login(server.port, server.token));
  }

  get headers() { return {cookie: this.cookie, origin: this.base}; }

  /** POST /api/<endpoint> with {args}; resolves to the value or throws an Error with .code. */
  async call(endpoint, args = {}, {signal, timeoutMs = 60000} = {}) {
    const rpcId = `cli-${process.pid}-${++rpcCounter}-${Date.now()}`;
    const response = await fetch(`${this.base}/api/${endpoint}`, {
      method: 'POST', headers: {'content-type': 'application/json', ...this.headers},
      body: JSON.stringify({type: 'client-request', rpcId, method: endpoint, payload: {args}}),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw Object.assign(Error(`Atelier answered HTTP ${response.status} for ${endpoint}.`), {code: `http-${response.status}`});
    const body = await response.json();
    if (body?.result?.ok === true) return body.result.value;
    const error = body?.result?.error ?? {code: 'internal', message: 'unexpected answer'};
    throw Object.assign(Error(error.message), {code: error.code, details: error.details});
  }

  /** session/list; the argument's wire name differs between builds (`_request` in lib, `request` in src). */
  async listSessions() {
    const args = this.listArgs ?? {_request: {}};
    try { return (await this.call('session/list', args)).items ?? []; }
    catch (error) {
      if (error.code !== 'internal' || !/args fields do not match/.test(error.message)) throw error;
      this.listArgs = '_request' in args ? {request: {}} : {_request: {}};
      return (await this.call('session/list', this.listArgs)).items ?? [];
    }
  }

  /** The server accepts the login a moment before its services are up; wait for the session service. */
  async waitReady(timeoutMs = 60000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      try { await this.listSessions(); return; }
      catch (error) {
        if (Date.now() > deadline || !/unavailable/i.test(error.message)) throw error;
        await new Promise(r => setTimeout(r, 250));
      }
    }
  }

  async ensureSocket() {
    if (this.socket?.readyState === 1) return this.socket;
    if (this.opening) return this.opening;
    this.opening = new Promise((resolve, reject) => {
      // Node's WebSocket (undici) accepts headers, which carry the session cookie like a browser's would.
      const socket = new WebSocket(`ws://localhost:${this.port}/api/remote.mux`, {headers: this.headers});
      socket.addEventListener('open', () => { this.socket = socket; this.opening = undefined; resolve(socket); });
      socket.addEventListener('error', () => { this.opening = undefined; reject(Error('Could not open the live connection to Atelier.')); });
      socket.addEventListener('message', event => {
        let frame; try { frame = JSON.parse(String(event.data)); } catch { return; }
        const stream = this.streams.get(frame.streamId);
        if (!stream) return;
        if (frame.type === 'item') stream.push(frame.value);
        else if (frame.type === 'error') stream.fail(Object.assign(Error(frame.error?.message ?? 'stream failed'), {code: frame.error?.code}));
        else if (frame.type === 'end') stream.end();
      });
      socket.addEventListener('close', () => {
        this.socket = undefined;
        for (const stream of this.streams.values()) stream.fail(Object.assign(Error('The live connection to Atelier closed.'), {code: 'closed'}));
      });
    });
    return this.opening;
  }

  /**
   * Open a live stream (session/follow, session/control, $events). Returns an async iterable with .cancel().
   */
  async open(endpoint, args = {}) {
    const socket = await this.ensureSocket();
    const streamId = `s${++rpcCounter}`;
    const queue = [], waiters = [];
    let done = false, failure;
    const settle = () => { while (waiters.length && (queue.length || done)) { const w = waiters.shift(); if (queue.length) w.resolve({value: queue.shift(), done: false}); else if (failure) w.reject(failure); else w.resolve({value: undefined, done: true}); } };
    const stream = {
      push: value => { queue.push(value); settle(); },
      end: () => { done = true; this.streams.delete(streamId); settle(); },
      fail: error => { failure = error; done = true; this.streams.delete(streamId); settle(); },
    };
    this.streams.set(streamId, stream);
    socket.send(JSON.stringify({type: 'open', streamId, endpoint, payload: {args}}));
    return {
      cancel: () => {
        if (done) return;
        done = true; this.streams.delete(streamId); settle();
        if (this.socket?.readyState === 1) this.socket.send(JSON.stringify({type: 'cancel', streamId}));
      },
      [Symbol.asyncIterator]() {
        return {
          next: () => queue.length ? Promise.resolve({value: queue.shift(), done: false})
            : done ? (failure ? Promise.reject(failure) : Promise.resolve({value: undefined, done: true}))
              : new Promise((resolve, reject) => { waiters.push({resolve, reject}); }),
          return: () => { stream.end(); return Promise.resolve({value: undefined, done: true}); },
        };
      },
    };
  }

  /** GET /api/session.export: a zip with session.jsonl, subagents and media. */
  async exportZip(sessionId) {
    const response = await fetch(`${this.base}/api/session.export?sessionId=${encodeURIComponent(sessionId)}&includeDescendants=true`, {headers: this.headers});
    if (response.status === 404) throw Error(`No chat with id ${sessionId}.`);
    if (!response.ok) throw Error(`Atelier answered HTTP ${response.status} to the export.`);
    return Buffer.from(await response.arrayBuffer());
  }

  close() {
    for (const stream of this.streams.values()) stream.end();
    try { this.socket?.close(); } catch { /* closed */ }
  }
}

/**
 * Find or start a server for this home and log in. The caller must `release()` when done; that closes the client
 * and stops the server only if this call started it (and keep is false).
 */
export async function attach(home, {port, keep = false, onStarting} = {}) {
  let server = await findServer(home);
  let started = false;
  if (!server) {
    onStarting?.();
    server = await startServer(home, {port});
    started = true;
  }
  const client = await AtelierClient.connect(server);
  await client.waitReady();
  return {
    server, client, started,
    release: () => { client.close(); if (started && !keep) stopServer(server, home); },
  };
}
