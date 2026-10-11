// Bottega, paired devices and pairing codes.
//
// A device is paired once with a short code. Afterwards it holds a random device token in a cookie; only the
// SHA-256 of that token is stored here, so a copy of devices.json cannot be used to sign in. Revoking a device
// deletes its record, which ends its access at the next request (the gateway also closes its open connections).
import {createHash, randomBytes, randomInt, randomUUID, timingSafeEqual} from 'node:crypto';
import {chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs';
import {dirname} from 'node:path';

export const DAY_MS = 86_400_000;
export const MINUTE_MS = 60_000;
const sha256 = text => createHash('sha256').update(text).digest('hex');

/** A label safe to show: no markup or control characters, at most 40 characters. */
export function cleanName(value, fallback = 'Device') {
  const text = String(value ?? '').replace(/[\u0000-\u001f\u007f<>"'`&\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
  return text || fallback;
}

/** "iPad (Safari)" from a User-Agent string. Only a label; nothing depends on it. */
export function describeAgent(userAgent) {
  const ua = String(userAgent ?? '');
  const device = /iPad/.test(ua) ? 'iPad' : /iPhone/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android device'
    : /Windows/.test(ua) ? 'Windows PC' : /Macintosh|Mac OS X/.test(ua) ? 'Mac' : /Linux|X11/.test(ua) ? 'Linux PC' : 'Device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /Firefox\/|FxiOS/.test(ua) ? 'Firefox'
    : /Chrome\/|CriOS/.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
  return browser ? `${device} (${browser})` : device;
}

/** Paired devices, kept in one small JSON file next to Atelier's settings. */
export class DeviceStore {
  /**
   * @param {{file?: string, ttlMs?: number, now?: () => number}} options file: where to keep devices (omit for memory only);
   *   ttlMs: how long a device stays paired after it was last used.
   */
  constructor({file, ttlMs = 30 * DAY_MS, now = Date.now} = {}) {
    this.file = file; this.ttlMs = ttlMs; this.now = now;
    this.devices = new Map();            // id -> record
    this.byHash = new Map();             // token hash -> id
    this.lastSaved = 0;
    this.load();
  }

  load() {
    this.devices.clear(); this.byHash.clear();
    if (!this.file) return;
    let raw;
    try { raw = JSON.parse(readFileSync(this.file, 'utf8')); } catch { return; }   // missing or damaged: start empty
    for (const d of Array.isArray(raw?.devices) ? raw.devices : []) {
      if (typeof d?.id !== 'string' || typeof d.hash !== 'string' || !(d.expiresAt > this.now())) continue;
      this.devices.set(d.id, d); this.byHash.set(d.hash, d.id);
    }
  }

  save() {
    this.lastSaved = this.now();
    if (!this.file) return;
    try {
      mkdirSync(dirname(this.file), {recursive: true});
      const temp = `${this.file}.${process.pid}.tmp`;
      writeFileSync(temp, JSON.stringify({version: 1, devices: [...this.devices.values()]}, null, 2), {mode: 0o600});
      renameSync(temp, this.file);
      try { chmodSync(this.file, 0o600); } catch { /* not supported on every file system */ }
    } catch { /* a read-only home must not break Atelier; devices then last until it stops */ }
  }

  /** What the owner sees: never the token or its hash. */
  list() {
    return [...this.devices.values()].sort((a, b) => b.lastSeen - a.lastSeen)
      .map(({id, name, createdAt, lastSeen, address, agent}) => ({id, name, createdAt, lastSeen, address, agent}));
  }

  /** Pair a new device. Returns the token exactly once: it is stored only as a hash. */
  add({name, userAgent, address} = {}) {
    const token = randomBytes(32).toString('base64url');
    const at = this.now();
    const agent = describeAgent(userAgent);
    const device = {id: randomUUID(), name: cleanName(name, agent), hash: sha256(token), createdAt: at, lastSeen: at,
      expiresAt: at + this.ttlMs, address: String(address ?? '').replace(/^::ffff:/i, '').slice(0, 64), agent};
    this.devices.set(device.id, device); this.byHash.set(device.hash, device.id);
    this.save();
    const {id, createdAt, lastSeen} = device;
    return {token, device: {id, name: device.name, createdAt, lastSeen, address: device.address, agent}};
  }

  /** The device this token belongs to, or null (unknown, revoked or expired). */
  verify(token) {
    if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
    const hash = sha256(token);
    const id = this.byHash.get(hash);
    const device = id === undefined ? undefined : this.devices.get(id);
    if (!device || !timingSafeEqual(Buffer.from(device.hash), Buffer.from(hash))) return null;
    const at = this.now();
    if (at >= device.expiresAt) { this.revoke(device.id); return null; }
    device.lastSeen = at;
    device.expiresAt = at + this.ttlMs;                       // used devices stay paired
    if (at - this.lastSaved > MINUTE_MS) this.save();
    return device;
  }

  has(id) { return this.devices.has(id); }

  revoke(id) {
    const device = this.devices.get(id);
    if (!device) return false;
    this.devices.delete(id); this.byHash.delete(device.hash);
    this.save();
    return true;
  }

  revokeAll() {
    const ids = [...this.devices.keys()];
    this.devices.clear(); this.byHash.clear();
    this.save();
    return ids;
  }
}

/**
 * One pairing code at a time, kept in memory only (never written to disk or the log). Six digits, valid for ten
 * minutes, usable once, and dead after five wrong tries.
 */
export class PairingCodes {
  constructor({ttlMs = 10 * MINUTE_MS, maxWrong = 5, now = Date.now} = {}) {
    this.ttlMs = ttlMs; this.maxWrong = maxWrong; this.now = now; this.current = null;
  }

  /** Make a new code; the previous one stops working. */
  create() {
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    this.current = {code, hash: sha256(code), expiresAt: this.now() + this.ttlMs, wrong: 0};
    return {code, expiresAt: this.current.expiresAt};
  }

  /** The code to show on the host screen, or null when none is usable. */
  active() {
    const c = this.current;
    if (!c) return null;
    if (this.now() > c.expiresAt || c.wrong >= this.maxWrong) { this.current = null; return null; }
    return {code: c.code, expiresAt: c.expiresAt, triesLeft: this.maxWrong - c.wrong};
  }

  clear() { this.current = null; }

  /** 'ok' (and the code is used up), 'none', 'expired', 'locked' or 'wrong'. */
  check(given) {
    const c = this.current;
    if (!c) return 'none';
    if (this.now() > c.expiresAt) { this.current = null; return 'expired'; }
    if (c.wrong >= this.maxWrong) { this.current = null; return 'locked'; }
    const digits = String(given ?? '').replace(/[\s-]/g, '');
    const same = /^\d{6}$/.test(digits) && timingSafeEqual(Buffer.from(sha256(digits)), Buffer.from(c.hash));
    if (same) { this.current = null; return 'ok'; }
    c.wrong += 1;
    return 'wrong';
  }
}

/** Slows guessing from one address: after `max` failures in the window it refuses that address for the rest of it. */
export class FailureLimiter {
  constructor({max = 8, windowMs = 10 * MINUTE_MS, now = Date.now} = {}) {
    this.max = max; this.windowMs = windowMs; this.now = now; this.failures = new Map();
  }

  recent(key) {
    const cutoff = this.now() - this.windowMs;
    const list = (this.failures.get(key) ?? []).filter(t => t > cutoff);
    if (list.length) this.failures.set(key, list); else this.failures.delete(key);
    return list;
  }

  fail(key) {
    const list = this.recent(key);
    list.push(this.now()); this.failures.set(key, list);
    if (this.failures.size > 500) for (const k of this.failures.keys()) { this.recent(k); if (this.failures.size <= 250) break; }
  }

  clear(key) { this.failures.delete(key); }

  /** Milliseconds until this address may try again; 0 when it may try now. */
  blockedFor(key) {
    const list = this.recent(key);
    return list.length >= this.max ? Math.max(0, list[0] + this.windowMs - this.now()) : 0;
  }
}
