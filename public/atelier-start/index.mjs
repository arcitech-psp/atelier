// Atelier new-chat page, host half: one read-only RPC that tells the page which model new chats use and whether its
// endpoint answers. The browser half (client.js) draws the page.
import { readFile } from 'node:fs/promises';
import { dshHomePath } from '@deepseek-ai/dsh-home-paths';
import { readStatus } from './status.mjs';
import { createBottega, DEFAULT_PORT } from './bottega/bottega.mjs';
import { tokenSource } from './bottega/host-session.mjs';

export const inject = [];
export const name = 'atelier-start';

/** One answer per 20 s at most: opening several new chats must not hammer a model server. */
const TTL_MS = 20_000;

export function apply(ctx) {
  let cached; // {at, value: Promise}
  const status = () => {
    if (cached && Date.now() - cached.at < TTL_MS) return cached.value;
    const value = readFile(dshHomePath('settings.yaml'), 'utf8').then(text => readStatus(text), () => ({kind: 'unset'}));
    cached = {at: Date.now(), value};
    return value;
  };
  // Browser RPC only exists in the web profile; headless, ACP and SDK runs load this plugin without it.
  ctx.inject(['connection'], ctx => ctx.effect(() => ctx.connection.rpc.handle('/atelier-start', async endpoint => {
    try {
      if (endpoint === 'status') return {ok: true, value: await status()};
      throw Error('Unknown start-page operation.');
    } catch (e) { return {ok: false, error: {code: 'bad-request', message: e.message}}; }
  })));
  ctx.inject(['connection', 'webServer'], ctx => ctx.effect(() => mountBottega(ctx), 'atelier-start: Bottega'));
}

const truthy = value => /^(1|yes|on|true)$/i.test(String(value ?? '').trim());
const falsy = value => /^(0|no|off|false)$/i.test(String(value ?? '').trim());

/**
 * Bottega (team mode). Off unless the owner switched it on: from the start page (remembered for next time), or with
 * ATELIER_BOTTEGA=1 at launch. ATELIER_BOTTEGA=0 keeps it off whatever was remembered. The RPC channel below is the
 * only way to change it, and the gateway never forwards that channel to a paired device.
 */
function mountBottega(ctx) {
  const env = process.env;
  const say = line => process.stdout.write(`[bottega] ${line}\n`);
  const bind = String(env.ATELIER_BOTTEGA_BIND ?? '').split(',').map(a => a.trim()).filter(Boolean);
  const wantedPort = Number(env.ATELIER_BOTTEGA_PORT);
  const bottega = createBottega({
    hostPort: () => ctx.webServer.port,
    token: tokenSource(dshHomePath('.browser-launch-token')),
    stateDir: dshHomePath('atelier-bottega'),
    port: Number.isInteger(wantedPort) && wantedPort >= 1024 && wantedPort <= 65535 ? wantedPort : DEFAULT_PORT,
    bind: bind.length > 0 ? bind : undefined,
    log: say,
  });
  const turnOn = async () => {
    await bottega.start(); bottega.remember(true);
    if (!bottega.pairing.active()) bottega.newCode();
  };
  const turnOff = () => { bottega.stop(); bottega.remember(false); };
  const answer = async () => ({ok: true, value: await bottega.status()});

  const dispose = ctx.connection.rpc.handle('/atelier-bottega', async (endpoint, payload) => {
    try {
      if (endpoint === 'status') return await answer();
      if (endpoint === 'enable') { if (payload?.on === true) await turnOn(); else turnOff(); return await answer(); }
      if (endpoint === 'code') { if (!bottega.running) throw Error('Bottega is off.'); bottega.newCode(); return await answer(); }
      if (endpoint === 'revoke') { if (typeof payload?.id !== 'string') throw Error('Which device?'); bottega.revoke(payload.id); return await answer(); }
      if (endpoint === 'revoke-all') { bottega.revokeAll(); return await answer(); }
      throw Error('Unknown Bottega operation.');
    } catch (e) { return {ok: false, error: {code: 'bad-request', message: e.message}}; }
  });

  const launch = env.ATELIER_BOTTEGA;
  if (truthy(launch) || (!falsy(launch) && bottega.remembered())) {
    void turnOn().then(async () => {
      if (!truthy(env.ATELIER_BOTTEGA_PRINT)) return;
      // A terminal start (not the desktop launcher, whose log is kept): show where to pair and the first code.
      const state = await bottega.status();
      const code = state.code?.code;
      say(state.urls.length ? `Open ${state.urls.join(' or ')} on another device on this network.` : 'Waiting for a private network address.');
      if (code) say(`Pairing code ${code.slice(0, 3)} ${code.slice(3)} (valid 10 minutes, one use).`);
    }).catch(e => say(`could not start: ${e.message}`));
  }
  return () => { bottega.stop(); return dispose(); };
}
