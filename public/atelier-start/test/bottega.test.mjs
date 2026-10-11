// Bottega tests: pairing, revoking, expiry and the guards of the LAN gateway, against a stand-in Atelier host.
// Runs anywhere with Node alone (no Atelier install, no network): `node --test public/atelier-start/test/`.
// The gateway listens on 127.0.0.1 here (the test address) on a free port; nothing else on the machine is touched.
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import {mkdtempSync, readFileSync, rmSync, statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {after, before, describe, test} from 'node:test';
import {createBottega} from '../bottega/bottega.mjs';
import {createGatewayServer, isManagementPath, forwardHeaders, refusal, rewriteLocation} from '../bottega/gateway.mjs';
import {DeviceStore, FailureLimiter, PairingCodes, cleanName, describeAgent} from '../bottega/devices.mjs';
import {allowedHosts, clientAllowed, isPrivateLan, lanInterfaces} from '../bottega/network.mjs';
import {tokenSource} from '../bottega/host-session.mjs';
import {writeFileSync} from 'node:fs';

const LAUNCH_TOKEN = 'launch-token-for-the-test-host';
const HOST_SESSION = 'dsh-auth-test=host-session-value';

/** A stand-in for the Atelier host: token sign-in, a page, an echo of what it received, an upgrade echo. */
async function startFakeHost() {
  const hits = [];
  const ok = req => String(req.headers.cookie ?? '').includes(HOST_SESSION);
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    hits.push({method: req.method, path: url.pathname, headers: req.headers});
    if (url.pathname === '/' && url.searchParams.has('token')) {
      if (url.searchParams.get('token') !== LAUNCH_TOKEN) { res.writeHead(401); return res.end('no'); }
      res.writeHead(303, {location: '/', 'set-cookie': `${HOST_SESSION}; Max-Age=3600; Path=/; HttpOnly; SameSite=Strict`});
      return res.end();
    }
    if (!ok(req)) { res.writeHead(401); return res.end('host: unauthorized'); }
    if (url.pathname === '/echo') { res.writeHead(200, {'content-type': 'application/json', 'set-cookie': 'leak=1'}); return res.end(JSON.stringify(req.headers)); }
    if (url.pathname === '/redirect') { res.writeHead(302, {location: `http://localhost:${server.address().port}/landed`}); return res.end(); }
    if (url.pathname.toLowerCase().includes('atelier-bottega')) { res.writeHead(200); return res.end('MANAGEMENT'); }
    res.writeHead(200, {'content-type': 'text/html'});
    res.end('<!doctype html><title>ATELIER-HOST-OK</title>');
  });
  server.on('upgrade', (req, socket) => {
    hits.push({method: 'UPGRADE', path: req.url, headers: req.headers});
    if (!ok(req)) return socket.end('HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: test\r\nConnection: Upgrade\r\n\r\n');
    socket.on('data', chunk => socket.write(`echo:${chunk}`));
    socket.on('error', () => {});
  });
  await new Promise(done => server.listen(0, 'localhost', done));
  return {server, hits, port: server.address().port, close: () => { server.closeAllConnections(); server.close(); }};
}

const freePort = () => new Promise(done => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => done(p)); }); });

/** A gateway on 127.0.0.1 in front of a fresh stand-in host and a throwaway state folder. */
async function setup(extra = {}) {
  const host = await startFakeHost();
  const dir = mkdtempSync(join(tmpdir(), 'bottega-test-'));
  const clock = {t: 1_800_000_000_000};
  const port = await freePort();
  const bottega = createBottega({hostPort: () => host.port, token: () => LAUNCH_TOKEN, stateDir: dir, port, bind: ['127.0.0.1'],
    hostname: 'studio-pc', now: () => clock.t, ...extra});
  const base = `http://127.0.0.1:${port}`;
  const finish = () => { bottega.stop(); host.close(); rmSync(dir, {recursive: true, force: true}); };
  return {host, dir, clock, port, bottega, base, finish};
}

const get = (url, headers = {}) => fetch(url, {redirect: 'manual', headers});
const page = {accept: 'text/html', 'sec-fetch-dest': 'document', 'sec-fetch-site': 'none'};
async function pair(ctx, code, extraHeaders = {}) {
  return fetch(`${ctx.base}/__bottega/pair`, {method: 'POST', redirect: 'manual', body: new URLSearchParams({code, name: 'Test tablet'}),
    headers: {'content-type': 'application/x-www-form-urlencoded', origin: ctx.base, ...extraHeaders}});
}
const deviceCookie = response => (response.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).find(c => c.startsWith('atelier-bottega-'));

describe('Bottega gateway', () => {
  test('is off until started: nothing listens, nothing is written', async () => {
    const ctx = await setup();
    try {
      assert.equal(ctx.bottega.running, false);
      await assert.rejects(get(`${ctx.base}/`), /fetch failed/);
      assert.equal((await ctx.bottega.status()).on, false);
      assert.equal(ctx.bottega.remembered(), false);
    } finally { ctx.finish(); }
  });

  test('an unpaired client is refused everywhere and reaches nothing on the host', async () => {
    const ctx = await setup();
    try {
      await ctx.bottega.start();
      const pageLoad = await get(`${ctx.base}/`, page);
      assert.equal(pageLoad.status, 302);
      assert.equal(pageLoad.headers.get('location'), '/__bottega/pair');
      const api = await get(`${ctx.base}/api/session/list`, {accept: 'application/json'});
      assert.equal(api.status, 401);
      assert.equal((await fetch(`${ctx.base}/api/x`, {method: 'POST', body: '{}', headers: {'content-type': 'application/json'}})).status, 401);
      assert.equal((await get(`${ctx.base}/echo`, {cookie: 'atelier-bottega-1=forged-token-forged-token-forged'})).status, 401);
      const form = await (await get(`${ctx.base}/__bottega/pair`)).text();
      assert.match(form, /Pair this device/);
      assert.deepEqual(ctx.host.hits, [], 'the host saw no request at all');
    } finally { ctx.finish(); }
  });

  test('a good code pairs a device; the host sees only the gateway\'s own session', async () => {
    const ctx = await setup();
    try {
      await ctx.bottega.start();
      const { code } = ctx.bottega.newCode();
      const response = await pair(ctx, code);
      assert.equal(response.status, 303);
      const cookie = deviceCookie(response);
      assert.ok(cookie, 'a device cookie was set');
      assert.match(response.headers.get('set-cookie'), /HttpOnly/);
      assert.match(response.headers.get('set-cookie'), /SameSite=Strict/);
      const home = await get(`${ctx.base}/`, {...page, cookie});
      assert.equal(home.status, 200);
      assert.match(await home.text(), /ATELIER-HOST-OK/);
      const echo = await get(`${ctx.base}/echo`, {cookie, origin: ctx.base, 'x-forwarded-for': '9.9.9.9', 'x-bottega-device': 'forged'});
      const seen = await echo.json();
      assert.equal(seen.cookie, HOST_SESSION.split(';')[0], 'the device cookie is replaced by the gateway\'s session');
      assert.equal(seen.host, `localhost:${ctx.host.port}`);
      assert.equal(seen.origin, `http://localhost:${ctx.host.port}`);
      assert.equal(seen['x-forwarded-for'], undefined);
      assert.equal(seen['x-bottega-device'], undefined);
      assert.equal(echo.headers.get('set-cookie'), null, 'host cookies never reach the device');
      assert.equal(ctx.bottega.devices.list().length, 1);
      assert.equal(ctx.bottega.devices.list()[0].name, 'Test tablet');
      const bounce = await get(`${ctx.base}/redirect`, {cookie});
      assert.equal(bounce.headers.get('location'), `http://127.0.0.1:${ctx.port}/landed`);
    } finally { ctx.finish(); }
  });

  test('a wrong code is refused and counted; five wrong tries kill the code', async () => {
    const ctx = await setup();
    try {
      await ctx.bottega.start();
      const { code } = ctx.bottega.newCode();
      const wrong = code === '000000' ? '111111' : '000000';
      for (let i = 0; i < 5; i += 1) {
        const response = await pair(ctx, wrong);
        assert.equal(response.status, 401);
        assert.equal(deviceCookie(response), undefined);
      }
      const late = await pair(ctx, code);
      assert.equal(late.status, 401, 'the right code no longer works once locked');
      assert.match(await late.text(), /choose New code|No pairing code/);
      assert.equal(ctx.bottega.devices.list().length, 0);
    } finally { ctx.finish(); }
  });

  test('an expired code is refused', async () => {
    const ctx = await setup();
    try {
      await ctx.bottega.start();
      const { code } = ctx.bottega.newCode();
      ctx.clock.t += 10 * 60_000 + 1000;
      const response = await pair(ctx, code);
      assert.equal(response.status, 401);
      assert.match(await response.text(), /expired/);
      assert.equal(ctx.bottega.devices.list().length, 0);
      assert.equal(ctx.bottega.pairing.active(), null);
    } finally { ctx.finish(); }
  });

  test('a code works once', async () => {
    const ctx = await setup();
    try {
      await ctx.bottega.start();
      const { code } = ctx.bottega.newCode();
      assert.equal((await pair(ctx, code)).status, 303);
      assert.equal((await pair(ctx, code)).status, 401);
      assert.equal(ctx.bottega.devices.list().length, 1);
    } finally { ctx.finish(); }
  });

  test('a revoked device is refused at once, and its open connections are closed', async () => {
    const ctx = await setup();
    try {
      await ctx.bottega.start();
      const { code } = ctx.bottega.newCode();
      const cookie = deviceCookie(await pair(ctx, code));
      assert.equal((await get(`${ctx.base}/echo`, {cookie})).status, 200);

      // an open WebSocket-style connection
      const socket = net.connect(ctx.port, '127.0.0.1');
      await new Promise(done => socket.once('connect', done));
      socket.write(`GET /ws HTTP/1.1\r\nHost: 127.0.0.1:${ctx.port}\r\nConnection: Upgrade\r\nUpgrade: test\r\nCookie: ${cookie}\r\n\r\n`);
      const opened = await new Promise(done => socket.once('data', d => done(String(d))));
      assert.match(opened, /101 Switching Protocols/);
      socket.write('hi');
      assert.match(await new Promise(done => socket.once('data', d => done(String(d)))), /echo:hi/);
      const closed = new Promise(done => socket.once('close', done));

      const id = ctx.bottega.devices.list()[0].id;
      assert.equal(ctx.bottega.revoke(id), true);
      await closed;
      const after = await get(`${ctx.base}/echo`, {cookie});
      assert.equal(after.status, 401);
      assert.equal((await get(`${ctx.base}/`, {...page, cookie})).status, 302);
      assert.equal(ctx.bottega.devices.list().length, 0);
    } finally { ctx.finish(); }
  });

  test('revoke all removes every device', async () => {
    const ctx = await setup();
    try {
      await ctx.bottega.start();
      const cookies = [];
      for (let i = 0; i < 2; i += 1) cookies.push(deviceCookie(await pair(ctx, ctx.bottega.newCode().code)));
      assert.equal(ctx.bottega.revokeAll(), 2);
      for (const cookie of cookies) assert.equal((await get(`${ctx.base}/echo`, {cookie})).status, 401);
    } finally { ctx.finish(); }
  });

  test('a device that was never used again expires after 30 days; use keeps it paired', async () => {
    const ctx = await setup();
    try {
      await ctx.bottega.start();
      const cookie = deviceCookie(await pair(ctx, ctx.bottega.newCode().code));
      ctx.clock.t += 20 * 86_400_000;
      assert.equal((await get(`${ctx.base}/echo`, {cookie})).status, 200);
      ctx.clock.t += 20 * 86_400_000;
      assert.equal((await get(`${ctx.base}/echo`, {cookie})).status, 200, 'still paired: it was used 20 days ago');
      ctx.clock.t += 31 * 86_400_000;
      assert.equal((await get(`${ctx.base}/echo`, {cookie})).status, 401);
    } finally { ctx.finish(); }
  });

  test('Bottega\'s own management channel is never reachable through the gateway', async () => {
    const ctx = await setup();
    try {
      await ctx.bottega.start();
      const cookie = deviceCookie(await pair(ctx, ctx.bottega.newCode().code));
      for (const path of ['/atelier-bottega/status', '/ATELIER-BOTTEGA/status', '/%61telier-bottega/status', '/a/../atelier-bottega/enable',
        '/atelier%2Dbottega/status', '/%2561telier-bottega/x', '/x/%5C..%5Catelier-bottega']) {
        const response = await fetch(`${ctx.base}${path}`, {method: 'POST', redirect: 'manual', headers: {cookie, 'content-type': 'application/json'}, body: '{}'});
        assert.equal(response.status, 403, path);
      }
      assert.ok(!ctx.host.hits.some(h => h.path.toLowerCase().includes('bottega')), 'none of them reached the host');
    } finally { ctx.finish(); }
  });

  test('WebSocket upgrades need a paired device too', async () => {
    const ctx = await setup();
    try {
      await ctx.bottega.start();
      const socket = net.connect(ctx.port, '127.0.0.1');
      await new Promise(done => socket.once('connect', done));
      socket.write(`GET /ws HTTP/1.1\r\nHost: 127.0.0.1:${ctx.port}\r\nConnection: Upgrade\r\nUpgrade: test\r\n\r\n`);
      assert.match(await new Promise(done => socket.once('data', d => done(String(d)))), /401 Unauthorized/);
      assert.ok(!ctx.host.hits.some(h => h.method === 'UPGRADE'));
    } finally { ctx.finish(); }
  });

  test('a request for another host name is refused (DNS rebinding)', async () => {
    const ctx = await setup();
    try {
      await ctx.bottega.start();
      const status = await new Promise((resolve, reject) => {
        const req = http.request({host: '127.0.0.1', port: ctx.port, path: '/__bottega/pair', headers: {host: `evil.example:${ctx.port}`}}, res => { res.resume(); resolve(res.statusCode); });
        req.on('error', reject); req.end();
      });
      assert.equal(status, 421);
      const named = await new Promise((resolve, reject) => {
        const req = http.request({host: '127.0.0.1', port: ctx.port, path: '/__bottega/pair', headers: {host: `studio-pc.local:${ctx.port}`}}, res => { res.resume(); resolve(res.statusCode); });
        req.on('error', reject); req.end();
      });
      assert.equal(named, 200, 'this computer\'s own name is accepted');
    } finally { ctx.finish(); }
  });

  test('a cross-site or foreign-origin pairing post is refused and does not spend the code', async () => {
    const ctx = await setup();
    try {
      await ctx.bottega.start();
      const { code } = ctx.bottega.newCode();
      assert.equal((await pair(ctx, code, {origin: 'http://evil.example'})).status, 403);
      assert.equal((await pair(ctx, code, {'sec-fetch-site': 'cross-site'})).status, 403);
      assert.equal((await pair(ctx, code, {'sec-fetch-site': 'same-site'})).status, 403, 'another port on this address');
      // what a real browser sends for the form on the pairing page (Referrer-Policy makes its Origin the string "null")
      assert.equal((await pair(ctx, code, {origin: 'null', 'sec-fetch-site': 'same-origin'})).status, 303, 'the code is still good');
    } finally { ctx.finish(); }
  });

  test('guessing from one address is slowed down after eight wrong codes', async () => {
    const ctx = await setup();
    try {
      await ctx.bottega.start();
      for (let i = 0; i < 8; i += 1) { ctx.bottega.newCode(); await pair(ctx, '123457'); }
      const response = await pair(ctx, ctx.bottega.newCode().code);
      assert.equal(response.status, 429);
      assert.equal(ctx.bottega.devices.list().length, 0);
    } finally { ctx.finish(); }
  });

  test('a device signs itself out', async () => {
    const ctx = await setup();
    try {
      await ctx.bottega.start();
      const cookie = deviceCookie(await pair(ctx, ctx.bottega.newCode().code));
      const out = await fetch(`${ctx.base}/__bottega/signout`, {method: 'POST', redirect: 'manual', headers: {cookie, origin: ctx.base}});
      assert.equal(out.status, 303);
      assert.equal((await get(`${ctx.base}/echo`, {cookie})).status, 401);
    } finally { ctx.finish(); }
  });

  test('paired devices survive a restart; the token is stored only as a hash', async () => {
    const ctx = await setup();
    try {
      await ctx.bottega.start();
      const response = await pair(ctx, ctx.bottega.newCode().code);
      const cookie = deviceCookie(response);
      const token = cookie.split('=')[1];
      const file = join(ctx.dir, 'devices.json');
      assert.ok(!readFileSync(file, 'utf8').includes(token), 'devices.json holds no token');
      if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o077, 0, 'owner-only file');
      ctx.bottega.stop();
      await assert.rejects(get(`${ctx.base}/`), /fetch failed/, 'stopping really closes the port');
      const again = createBottega({hostPort: () => ctx.host.port, token: () => LAUNCH_TOKEN, stateDir: ctx.dir, port: ctx.port, bind: ['127.0.0.1'], hostname: 'studio-pc', now: () => ctx.clock.t});
      await again.start();
      try {
        assert.equal(again.devices.list().length, 1);
        assert.equal((await get(`${ctx.base}/echo`, {cookie: `atelier-bottega-${ctx.port}=${token}`})).status, 200);
      } finally { again.stop(); }
    } finally { ctx.finish(); }
  });

  test('turning it on is remembered only when asked; the default is off', async () => {
    const ctx = await setup();
    try {
      assert.equal(ctx.bottega.remembered(), false);
      ctx.bottega.remember(true);
      assert.equal(ctx.bottega.remembered(), true);
      ctx.bottega.remember(false);
      assert.equal(ctx.bottega.remembered(), false);
    } finally { ctx.finish(); }
  });

  test('the host going away gives a clear 502, and the gateway signs in again when the host comes back', async () => {
    const ctx = await setup();
    try {
      await ctx.bottega.start();
      const cookie = deviceCookie(await pair(ctx, ctx.bottega.newCode().code));
      assert.equal((await get(`${ctx.base}/echo`, {cookie})).status, 200);
      ctx.bottega.session.invalidate();
      assert.equal((await get(`${ctx.base}/echo`, {cookie})).status, 200, 'signs in again by itself');
      const status = await ctx.bottega.status();
      assert.equal(status.host.ok, true);
      assert.deepEqual(status.urls, [`http://127.0.0.1:${ctx.port}/`]);
    } finally { ctx.finish(); }
  });
});

describe('Bottega rules', () => {
  test('only private LAN clients are served', () => {
    for (const a of ['192.168.1.20', '10.0.0.5', '172.16.4.4', '172.31.255.1', '::ffff:192.168.0.9']) assert.equal(isPrivateLan(a), true, a);
    for (const a of ['8.8.8.8', '100.64.0.7', '100.101.102.103', '169.254.10.10', '172.15.0.1', '172.32.0.1', '127.0.0.1', '::1', '2001:db8::1', '', undefined]) assert.equal(isPrivateLan(a), false, String(a));
    assert.equal(clientAllowed('127.0.0.1'), false);
    assert.equal(clientAllowed('127.0.0.1', {allowLoopback: true}), true);
    assert.equal(clientAllowed('8.8.8.8', {allowLoopback: true}), false);
  });

  test('a loopback client cannot connect to a gateway that is not on loopback (connection dropped)', async () => {
    const host = await startFakeHost();
    const dir = mkdtempSync(join(tmpdir(), 'bottega-test-'));
    const devices = new DeviceStore({file: join(dir, 'd.json')});
    const server = createGatewayServer({listenAddress: '127.0.0.1', port: 0, hostPort: host.port, session: {cookie: async () => HOST_SESSION, invalidate() {}},
      devices, pairing: new PairingCodes(), limiter: new FailureLimiter(), registry: {track() {}, closeDevice() {}}, hosts: new Set(), cookieName: 'c', allowLoopback: false});
    await new Promise(done => server.listen(0, '127.0.0.1', done));
    try {
      await assert.rejects(get(`http://127.0.0.1:${server.address().port}/`), /fetch failed/);
    } finally { server.close(); host.close(); rmSync(dir, {recursive: true, force: true}); }
  });

  test('Bottega never listens on a public address', async () => {
    const ctx = await setup({bind: ['8.8.8.8']});
    try {
      await ctx.bottega.start();
      const status = await ctx.bottega.status();
      assert.deepEqual(status.urls, []);
      assert.match(status.problems[0], /private network addresses/);
    } finally { ctx.finish(); }
  });

  test('network adapters: real LAN adapters only, in private ranges', () => {
    const table = {
      'Ethernet': [{family: 'IPv4', address: '192.168.1.20', internal: false}, {family: 'IPv6', address: 'fe80::1', internal: false}],
      'Wi-Fi': [{family: 'IPv4', address: '10.1.2.3', internal: false}],
      'Tailscale': [{family: 'IPv4', address: '100.100.1.1', internal: false}],
      'vEthernet (WSL)': [{family: 'IPv4', address: '172.20.0.1', internal: false}],
      'Loopback Pseudo-Interface 1': [{family: 'IPv4', address: '127.0.0.1', internal: true}],
      'Public': [{family: 'IPv4', address: '203.0.113.9', internal: false}],
      'docker0': [{family: 'IPv4', address: '172.17.0.1', internal: false}],
    };
    assert.deepEqual(lanInterfaces(table).map(a => a.address), ['192.168.1.20', '10.1.2.3']);
  });

  test('allowed host names', () => {
    assert.deepEqual([...allowedHosts('192.168.1.20', 3082, 'Studio-PC')].sort(), ['192.168.1.20:3082', 'studio-pc.local:3082', 'studio-pc:3082']);
    assert.deepEqual([...allowedHosts('192.168.1.20', 3082, 'bad name!')], ['192.168.1.20:3082']);
  });

  test('management path detection survives encoding tricks', () => {
    for (const p of ['/atelier-bottega/x', '/ATELIER-BOTTEGA', '/%61telier-bottega', '/%2561telier-bottega', '/x/..%5Catelier-bottega', '/atelier%2dbottega/status', '/%zz']) assert.equal(isManagementPath(p), true, p);
    for (const p of ['/', '/api/session/list', '/atelier-start/status', '/assets/app.js?x=atelier']) assert.equal(isManagementPath(p), false, p);
  });

  test('forwarded headers drop forgeable fields and carry the gateway\'s session', () => {
    const out = forwardHeaders({host: '192.168.1.20:3082', cookie: 'device=1', origin: 'http://192.168.1.20:3082', referer: 'http://192.168.1.20:3082/a',
      'x-forwarded-for': '1.2.3.4', 'x-bottega-device': 'x', forwarded: 'for=1', accept: '*/*'}, {hostPort: 3081, cookie: 'dsh=abc'});
    assert.deepEqual(out, {host: 'localhost:3081', cookie: 'dsh=abc', origin: 'http://localhost:3081', referer: 'http://localhost:3081/a', accept: '*/*'});
  });

  test('cross-site and foreign origin refusal; redirect rewrite', () => {
    const self = '192.168.1.20:3082';
    assert.equal(refusal({}, self), null, 'a script or curl: no browser labels');
    assert.equal(refusal({origin: 'http://192.168.1.20:3082'}, self), null);
    assert.ok(refusal({origin: 'http://evil.example'}, self));
    assert.ok(refusal({origin: 'null'}, self), 'an opaque origin without a browser label');
    assert.equal(refusal({origin: 'null', 'sec-fetch-site': 'same-origin'}, self), null, 'same-origin form post under no-referrer');
    assert.equal(refusal({'sec-fetch-site': 'none'}, self), null, 'a typed address');
    assert.ok(refusal({'sec-fetch-site': 'cross-site'}, self));
    assert.ok(refusal({'sec-fetch-site': 'same-site', origin: 'http://192.168.1.20:8080'}, self), 'another port on the same address');
    assert.ok(refusal({'sec-fetch-site': 'cross-site', origin: 'http://192.168.1.20:3082'}, self), 'the label beats a forged Origin');
    assert.equal(rewriteLocation('http://localhost:3081/a', 3081, self), 'http://192.168.1.20:3082/a');
    assert.equal(rewriteLocation('/relative', 3081, self), '/relative');
    assert.equal(rewriteLocation('http://example.com:3081/a', 3081, self), 'http://example.com:3081/a');
  });

  test('the launch token comes from the environment first, else a file that is re-read only every few seconds', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bottega-token-'));
    const file = join(dir, 'token');
    try {
      let t = 0;
      const read = tokenSource(file, {}, {ttlMs: 3000, now: () => t});
      assert.equal(read(), undefined, 'no file yet');
      writeFileSync(file, 'abc\n'); t = 1000;
      assert.equal(read(), undefined, 'still cached');
      t = 5000;
      assert.equal(read(), 'abc');
      writeFileSync(file, 'def'); t = 5100;
      assert.equal(read(), 'abc', 'cached');
      read.reset();
      assert.equal(read(), 'def', 'reset reads at once');
      assert.equal(tokenSource(file, {DSH_BROWSER_LAUNCH_TOKEN: ' from-env '})(), 'from-env');
    } finally { rmSync(dir, {recursive: true, force: true}); }
  });

  test('without a launch token the status says why instead of failing silently', async () => {
    const ctx = await setup({token: () => undefined});
    try {
      await ctx.bottega.start();
      const status = await ctx.bottega.status();
      assert.equal(status.host.ok, false);
      assert.match(status.host.message, /launcher/);
      const { code } = ctx.bottega.newCode();
      const cookie = deviceCookie(await pair(ctx, code));
      const response = await get(`${ctx.base}/echo`, {cookie});
      assert.equal(response.status, 502, 'a paired device gets a clear 502, not a hang');
    } finally { ctx.finish(); }
  });

  test('labels are cleaned', () => {
    assert.equal(cleanName('  <b>Anna\'s</b> "phone"\n'), 'b Anna s /b phone');
    assert.equal(cleanName('', 'iPad (Safari)'), 'iPad (Safari)');
    assert.equal(describeAgent('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit Version/17.0 Safari/605.1.15'), 'iPad (Safari)');
    assert.equal(describeAgent('Mozilla/5.0 (Windows NT 10.0) Chrome/120 Edg/120'), 'Windows PC (Edge)');
  });
});
