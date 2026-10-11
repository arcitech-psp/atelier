// Bottega, the gateway: one HTTP listener on one private LAN address of this computer, in front of the Atelier host.
//
// What it guarantees, in the order a request meets it:
//   1. The client's own address must be private (10.x, 172.16-31.x, 192.168.x). Anything else is dropped at connect.
//   2. The Host header must be this listener's address or this computer's name (closes DNS rebinding).
//   3. Cross-site and foreign-origin requests are refused (the device cookie is also SameSite=Strict).
//   4. Nothing but the pairing page is served without a valid device cookie. Every forwarded request, and every
//      WebSocket upgrade, is checked again, so a revoked device is out at its next request.
//   5. Bottega's own management channel is never forwarded: only the person at the host computer can turn Bottega
//      off, make codes or revoke devices.
//   6. The device never receives the host's cookie or launch token: the gateway signs in to the host itself and
//      attaches that session to what it forwards.
// The Atelier host itself keeps listening on localhost only.
import http from 'node:http';
import net from 'node:net';
import {DAY_MS} from './devices.mjs';
import {clientAllowed} from './network.mjs';
import {hostAuthority} from './host-session.mjs';
import {pairPage, hopPage, PAIR_MESSAGES} from './pages.mjs';

export const OWN_PREFIX = '/__bottega/';
/** The host's RPC channel that manages Bottega (see ../index.mjs). Never reachable through the gateway. */
export const MANAGEMENT_CHANNEL = 'atelier-bottega';

/** Value of one cookie from a Cookie header, or undefined. */
export function cookieValue(header, name) {
  for (const part of String(header ?? '').split(';')) {
    const at = part.indexOf('=');
    if (at > 0 && part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
  }
  return undefined;
}

/** Is this request target aimed at the management channel, however it is spelled? */
export function isManagementPath(target) {
  let path = String(target).split(/[?#]/)[0].replace(/\\/g, '/');
  for (let i = 0; i < 4; i += 1) {
    let decoded;
    try { decoded = decodeURIComponent(path); } catch { return true; }
    if (decoded === path) break;
    path = decoded;
  }
  return path.toLowerCase().includes(MANAGEMENT_CHANNEL);
}

/**
 * Why a request must be refused before it goes any further, or null. `host` is the Host header the client used.
 * Browsers label every request with Sec-Fetch-Site and a page's script cannot forge it, so it decides when present:
 * only a request from this very origin (or a person typing the address) passes, which also keeps out a page on
 * another port of this computer ("same-site"). Origin is the fallback for clients that send no such label. (A browser
 * sends "Origin: null" on a same-origin form post under Referrer-Policy: no-referrer, so Origin alone is not enough.)
 */
export function refusal(headers, host) {
  const site = headers['sec-fetch-site'];
  if (site === 'same-origin' || site === 'none') return null;
  if (site !== undefined) return site === 'same-site' ? 'request from another page on this address' : 'cross-site request';
  const origin = headers.origin;
  if (origin === undefined) return null;
  let originHost;
  try { originHost = new URL(origin).host.toLowerCase(); } catch { return 'unreadable origin'; }
  return originHost === String(host ?? '').toLowerCase() ? null : 'origin is not this gateway';
}

/** A browser page load (not an API call or asset). */
export function isPageLoad(headers) {
  const dest = headers['sec-fetch-dest'];
  if (dest !== undefined) return dest === 'document';
  return /text\/html/.test(String(headers.accept ?? ''));
}

/** A top-level page open from another site (a home-screen app launch, a link elsewhere). */
export function isCrossSiteOpen(req) {
  const h = req.headers;
  return req.method === 'GET' && h['sec-fetch-site'] === 'cross-site' && h['sec-fetch-mode'] === 'navigate' && h['sec-fetch-dest'] === 'document';
}

/** Headers for the leg to the host: a local Host and Origin, the gateway's own session, nothing the device could forge. */
export function forwardHeaders(headers, {hostPort, cookie}) {
  const authority = hostAuthority(hostPort);
  const out = {...headers};
  for (const name of Object.keys(out)) {
    if (/^x-bottega-|^x-forwarded-|^x-real-ip$|^forwarded$|^proxy-/i.test(name)) delete out[name];
  }
  out.host = authority;
  out.cookie = cookie;
  if (out.origin !== undefined) out.origin = `http://${authority}`;
  if (out.referer) out.referer = String(out.referer).replace(/^https?:\/\/[^/]+/, `http://${authority}`);
  return out;
}

/** An absolute redirect back to the host's own address must point at the gateway the device used. */
export function rewriteLocation(location, hostPort, selfHost) {
  return typeof location === 'string'
    ? location.replace(new RegExp(`^https?://(localhost|127\\.0\\.0\\.1|\\[::1\\]):${hostPort}(?=/|$)`, 'i'), `http://${selfHost}`) : location;
}

/** Open connections per device, so a revoked device is cut off at once and not only at its next request. */
export class ConnectionRegistry {
  constructor() { this.byDevice = new Map(); }

  track(deviceId, socket) {
    let set = this.byDevice.get(deviceId);
    if (!set) this.byDevice.set(deviceId, set = new Set());
    if (set.has(socket)) return;
    set.add(socket);
    socket.once('close', () => { set.delete(socket); if (set.size === 0 && this.byDevice.get(deviceId) === set) this.byDevice.delete(deviceId); });
  }

  closeDevice(deviceId) { for (const socket of [...this.byDevice.get(deviceId) ?? []]) socket.destroy(); }

  closeAll() { for (const id of [...this.byDevice.keys()]) this.closeDevice(id); }
}

const SECURITY = {'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'same-origin'};
const PAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";
const HOP_CSP = "default-src 'none'; script-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'";

/**
 * One listener. `options`: listenAddress, port, hostPort, session (HostSession), devices (DeviceStore), pairing
 * (PairingCodes), limiter (FailureLimiter), registry (ConnectionRegistry), hosts (allowed Host values), cookieName,
 * allowLoopback, upstreamHost, deviceTtlMs, log.
 */
export function createGatewayServer(options) {
  const {listenAddress, port, hostPort, session, devices, pairing, limiter, registry, hosts, cookieName,
    allowLoopback = false, upstreamHost = 'localhost', deviceTtlMs = 30 * DAY_MS, log = () => {}} = options;

  const respond = (res, status, body, type = 'text/plain; charset=utf-8', extra = {}) => {
    if (res.headersSent) return res.end();
    res.writeHead(status, {'content-type': type, ...SECURITY, ...extra});
    res.end(body);
  };
  const html = (res, status, body, csp = PAGE_CSP) => respond(res, status, body, 'text/html; charset=utf-8', {'content-security-policy': csp});
  const redirect = (res, status, location, extra = {}) => respond(res, status, '', 'text/plain; charset=utf-8', {location, ...extra});
  const deviceCookie = (token, maxAgeSeconds) => `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}`;
  const who = req => req.socket.remoteAddress ?? 'unknown';
  const hostHeader = req => String(req.headers.host ?? '').toLowerCase();
  const authenticate = req => devices.verify(cookieValue(req.headers.cookie, cookieName));
  const badTarget = req => typeof req.url !== 'string' || !req.url.startsWith('/') || req.url.startsWith('//');

  async function readBody(req, limit = 2048) {
    let body = '';
    for await (const chunk of req) { body += chunk; if (body.length > limit) return null; }
    return body;
  }

  /** The pairing page, the form post and the sign-out. Reached with or without a device cookie. */
  async function ownRoute(req, res, url) {
    const device = authenticate(req);
    if (url.pathname === `${OWN_PREFIX}ping` && req.method === 'GET') {
      return respond(res, 200, JSON.stringify({bottega: true, paired: Boolean(device)}), 'application/json');
    }
    if (url.pathname === `${OWN_PREFIX}signout` && req.method === 'POST') {
      if (refusal(req.headers, hostHeader(req))) return respond(res, 403, 'Refused');
      if (device) { devices.revoke(device.id); registry.closeDevice(device.id); log(`device "${device.name}" signed itself out`); }
      return redirect(res, 303, `${OWN_PREFIX}pair`, {'set-cookie': deviceCookie('', 0)});
    }
    if (url.pathname !== `${OWN_PREFIX}pair`) return respond(res, 404, 'Not found');
    if (req.method === 'GET') return device ? redirect(res, 303, '/') : html(res, 200, pairPage());
    if (req.method !== 'POST') return html(res, 405, pairPage({message: PAIR_MESSAGES.method}));

    const why = refusal(req.headers, hostHeader(req));
    if (why) {
      log(`pairing post from ${who(req)} refused: ${why} (origin ${req.headers.origin ?? 'none'}, fetch-site ${req.headers['sec-fetch-site'] ?? 'none'}, host ${hostHeader(req)})`);
      return html(res, 403, pairPage({message: PAIR_MESSAGES.cross}));
    }
    const address = who(req);
    const wait = limiter.blockedFor(address);
    if (wait > 0) return html(res, 429, pairPage({message: PAIR_MESSAGES.throttled, retryAfterSeconds: Math.ceil(wait / 1000)}), PAGE_CSP);
    const body = await readBody(req);
    if (body === null) return html(res, 413, pairPage({message: PAIR_MESSAGES.big}));
    const form = new URLSearchParams(body);
    const verdict = pairing.check(form.get('code'));
    if (verdict !== 'ok') {
      limiter.fail(address);
      log(`pairing refused for ${address}: ${verdict}`);
      return html(res, 401, pairPage({message: PAIR_MESSAGES[verdict]}));
    }
    limiter.clear(address);                                         // a good code clears that address's tries
    const paired = devices.add({name: form.get('name'), userAgent: req.headers['user-agent'], address});
    log(`paired "${paired.device.name}" from ${address}`);
    return redirect(res, 303, '/', {'set-cookie': deviceCookie(paired.token, Math.floor(deviceTtlMs / 1000))});
  }

  async function proxy(req, res, device, attempt = 0) {
    let cookie;
    try { cookie = await session.cookie(); }
    catch (error) { return respond(res, 502, `Atelier on the host computer is not ready (${error.message}) Try again in a moment.`); }
    const up = http.request({host: upstreamHost, port: hostPort, method: req.method, path: req.url,
      headers: forwardHeaders(req.headers, {hostPort, cookie})}, reply => {
      if (reply.statusCode === 401 && attempt === 0 && (req.method === 'GET' || req.method === 'HEAD')) {
        reply.resume(); session.invalidate();                  // the host restarted or renewed its login: sign in again once
        return void proxy(req, res, device, 1);
      }
      const headers = {...reply.headers};
      delete headers['set-cookie'];                             // the host's session never reaches a device
      if (headers.location) headers.location = rewriteLocation(headers.location, hostPort, req.headers.host);
      res.writeHead(reply.statusCode, reply.statusMessage, headers);
      reply.pipe(res);
    });
    up.on('error', error => {
      if (res.headersSent) return void res.destroy();
      respond(res, 502, `Atelier on the host computer is not answering (${error.code ?? 'error'}).`);
    });
    res.on('close', () => up.destroy());
    if (attempt === 0) req.pipe(up); else up.end();
  }

  const handler = async (req, res) => {
    try {
      if (badTarget(req)) return respond(res, 400, 'Bad request');
      if (!hosts.has(hostHeader(req))) return respond(res, 421, 'This address is not served here.');
      const url = new URL(req.url, 'http://bottega.invalid');
      if (url.pathname.startsWith(OWN_PREFIX)) return await ownRoute(req, res, url);
      // A page opened from another site (a home-screen icon) does not carry the Strict cookie: reload it once from here.
      if (isCrossSiteOpen(req)) return html(res, 200, hopPage(req.url), HOP_CSP);
      const why = refusal(req.headers, hostHeader(req));
      if (why) return respond(res, 403, `Refused: ${why}`);
      const device = authenticate(req);
      if (!device) {
        return req.method === 'GET' && isPageLoad(req.headers) ? redirect(res, 302, `${OWN_PREFIX}pair`)
          : respond(res, 401, 'Not paired. Open this address in a browser and enter the pairing code.');
      }
      if (isManagementPath(req.url)) return respond(res, 403, 'Bottega settings can only be changed on the host computer.');
      registry.track(device.id, req.socket);
      return await proxy(req, res, device);
    } catch (error) {
      log(`request failed: ${error.message}`);
      respond(res, 500, 'Bottega could not handle this request.');
    }
  };

  const server = http.createServer(handler);
  server.requestTimeout = 600_000;
  server.maxConnections = 256;
  server.on('connection', socket => {
    socket.on('error', () => {});
    if (!clientAllowed(socket.remoteAddress, {allowLoopback})) socket.destroy();
  });
  server.on('clientError', (error, socket) => { if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); else socket.destroy(); });

  // WebSockets and other upgrades: the same checks, then a raw pipe to the host with the gateway's session.
  server.on('upgrade', async (req, socket, head) => {
    const deny = (status, text) => { socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); };
    socket.on('error', () => {});
    try {
      if (badTarget(req)) return deny(400, 'Bad Request');
      if (!hosts.has(hostHeader(req))) return deny(421, 'Misdirected Request');
      if (refusal(req.headers, hostHeader(req))) return deny(403, 'Forbidden');
      const device = authenticate(req);
      if (!device) return deny(401, 'Unauthorized');
      if (isManagementPath(req.url)) return deny(403, 'Forbidden');
      registry.track(device.id, socket);
      let cookie;
      try { cookie = await session.cookie(); } catch { return deny(502, 'Bad Gateway'); }
      if (socket.destroyed) return;
      socket.pause();
      const up = net.connect({host: upstreamHost, port: hostPort});
      up.on('error', () => socket.destroy());
      socket.on('close', () => up.destroy());
      up.on('close', () => socket.destroy());
      up.on('connect', () => {
        const headers = forwardHeaders(req.headers, {hostPort, cookie});
        up.write(`${req.method} ${req.url} HTTP/1.1\r\n${Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n`);
        if (head?.length) up.write(head);
        up.pipe(socket); socket.pipe(up);
        socket.resume();
      });
    } catch { socket.destroy(); }
  });

  server.bottega = {listenAddress, port};
  return server;
}
