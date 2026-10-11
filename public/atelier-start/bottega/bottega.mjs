// Bottega, team mode: the Renaissance workshop where a master works with assistants. One Atelier host shares itself
// with other devices on the same private network, each paired once with a short code.
//
// This module owns the listeners (one per private LAN address, all on the same port), the paired devices and the
// pairing code. It starts nothing by itself: Atelier's start page switches it on and off (see ../index.mjs), or the
// ATELIER_BOTTEGA environment variable does at launch. It depends on Node's own modules only.
import os from 'node:os';
import {mkdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {DeviceStore, FailureLimiter, PairingCodes} from './devices.mjs';
import {ConnectionRegistry, createGatewayServer} from './gateway.mjs';
import {HostSession} from './host-session.mjs';
import {allowedHosts, isLoopback, isPrivateLan, lanInterfaces} from './network.mjs';

export const DEFAULT_PORT = 3082;
const PORT_TRIES = 10;

/**
 * @param {object} options
 * @param {() => number} options.hostPort   the Atelier host's port (it listens on localhost only)
 * @param {() => string | undefined} options.token   the host's launch token (see tokenSource)
 * @param {string} options.stateDir   where devices.json and settings.json live
 * @param {number} [options.port]   preferred Bottega port; the next free one is used when it is busy
 * @param {string[]} [options.bind]   listen on exactly these private (or, for tests, loopback) addresses
 * @param {() => object} [options.interfaces]   the network interface table (os.networkInterfaces)
 * @param {string} [options.hostname]
 * @param {(line: string) => void} [options.log]
 * @param {number} [options.syncMs]   how often network changes are noticed
 * @param {number} [options.codeTtlMs]  @param {number} [options.deviceTtlMs]  @param {typeof fetch} [options.fetchImpl]
 * @param {() => number} [options.now]
 */
export function createBottega(options) {
  const {hostPort, token, stateDir, port: preferredPort = DEFAULT_PORT, bind, interfaces = () => os.networkInterfaces(),
    hostname = os.hostname(), log = () => {}, syncMs = 20_000, codeTtlMs, deviceTtlMs, fetchImpl, now = Date.now} = options;

  const devices = new DeviceStore({file: join(stateDir, 'devices.json'), ...(deviceTtlMs ? {ttlMs: deviceTtlMs} : {}), now});
  const pairing = new PairingCodes({...(codeTtlMs ? {ttlMs: codeTtlMs} : {}), now});
  const limiter = new FailureLimiter({now});
  const registry = new ConnectionRegistry();
  const session = new HostSession({port: hostPort, token, ...(fetchImpl ? {fetchImpl} : {}), now});
  const listeners = new Map();                       // address -> {server, port}
  const problems = new Map();                        // address -> sentence
  let running = false, timer = null, port = null, syncing = null;

  const wanted = () => {
    if (bind?.length) {
      const bad = bind.filter(a => !isPrivateLan(a) && !isLoopback(a));
      if (bad.length) throw new Error(`Bottega only listens on private network addresses, not ${bad.join(', ')}.`);
      return [...new Set(bind)].map(address => ({name: 'configured', address}));
    }
    return lanInterfaces(interfaces());
  };

  const listen = (address, p) => new Promise((resolve, reject) => {
    const server = createGatewayServer({
      listenAddress: address, port: p, hostPort: hostPort(), session, devices, pairing, limiter, registry,
      hosts: allowedHosts(address, p, hostname), cookieName: `atelier-bottega-${p}`, allowLoopback: isLoopback(address),
      ...(deviceTtlMs ? {deviceTtlMs} : {}), log: line => log(line),
    });
    server.once('error', reject);
    server.listen({port: p, host: address, exclusive: true}, () => { server.off('error', reject); server.on('error', e => log(`listener ${address}:${p}: ${e.code ?? e.message}`)); resolve(server); });
  });

  async function openListener(address) {
    const candidates = port ? [port] : Array.from({length: PORT_TRIES}, (_, i) => preferredPort + i).filter(p => p <= 65535);
    let lastError;
    for (const p of candidates) {
      try {
        const server = await listen(address, p);
        if (!running) { server.close(); return; }                 // switched off while this was opening
        port = p; listeners.set(address, {server, port: p}); problems.delete(address);
        log(`Bottega listening on http://${address}:${p}/`);
        return;
      } catch (error) { lastError = error; if (error.code !== 'EADDRINUSE') break; }
    }
    problems.set(address, lastError?.code === 'EADDRINUSE' ? `Port ${port ?? preferredPort} is already in use on ${address}.`
      : `Could not listen on ${address} (${lastError?.code ?? lastError?.message}).`);
  }

  function closeListener(address) {
    const entry = listeners.get(address);
    if (!entry) return;
    listeners.delete(address);
    entry.server.close(); entry.server.closeAllConnections?.();
    log(`Bottega stopped listening on ${address} (the address is gone)`);
  }

  /** Follow the network: the laptop changes Wi-Fi, DHCP hands out a new address. */
  async function sync() {
    if (!running) return;
    syncing ??= (async () => {
      let found;
      try { found = wanted(); } catch (error) { problems.set('configuration', error.message); return; }
      problems.delete('configuration');
      const want = new Set(found.map(f => f.address));
      for (const address of [...listeners.keys()]) if (!want.has(address)) closeListener(address);
      for (const address of want) if (running && !listeners.has(address)) await openListener(address);
      for (const address of [...problems.keys()]) if (address !== 'configuration' && !want.has(address)) problems.delete(address);
    })().finally(() => { syncing = null; });
    return syncing;
  }

  const readSettings = () => { try { return JSON.parse(readFileSync(join(stateDir, 'settings.json'), 'utf8')); } catch { return {}; } };

  return {
    devices, pairing, registry, session, limiter,

    /** Was Bottega left on last time? Only an explicit switch-on is ever remembered; the default is off. */
    remembered() { return readSettings().enabled === true; },

    remember(enabled) {
      try {
        mkdirSync(stateDir, {recursive: true});
        const temp = join(stateDir, `settings.${process.pid}.tmp`);
        writeFileSync(temp, JSON.stringify({...readSettings(), enabled: enabled === true}), {mode: 0o600});
        renameSync(temp, join(stateDir, 'settings.json'));
      } catch { /* a read-only home: the switch then lasts until Atelier stops */ }
    },

    get running() { return running; },

    async start() {
      if (running) return sync();
      running = true;
      timer = setInterval(() => { void sync(); }, syncMs);
      timer.unref?.();
      return sync();
    },

    stop() {
      running = false;
      if (timer) clearInterval(timer);
      timer = null; port = null;
      for (const address of [...listeners.keys()]) {
        const {server} = listeners.get(address);
        listeners.delete(address);
        server.close(); server.closeAllConnections?.();
      }
      registry.closeAll(); pairing.clear(); session.invalidate(); problems.clear();
    },

    newCode() { return pairing.create(); },

    revoke(id) {
      const gone = devices.revoke(id);
      if (gone) registry.closeDevice(id);
      return gone;
    },

    revokeAll() {
      const ids = devices.revokeAll();
      for (const id of ids) registry.closeDevice(id);
      return ids.length;
    },

    /** Everything the start page shows. Read by the owner on the host computer only. */
    async status() {
      const urls = [...listeners].map(([address, {port: p}]) => `http://${address}:${p}/`);
      let host = null;
      if (running) {
        try { await session.cookie(); host = {ok: true}; }
        catch (error) { host = {ok: false, message: error.message}; }
      }
      return {
        on: running, port, urls, problems: [...problems.values()],
        waiting: running && listeners.size === 0 && problems.size === 0,
        code: pairing.active(), devices: devices.list(), host,
      };
    },
  };
}
