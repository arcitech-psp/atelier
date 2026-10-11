// Atelier new-chat page, host half: one read-only RPC that tells the page which model new chats use and whether its
// endpoint answers. The browser half (client.js) draws the page.
import { readFile } from 'node:fs/promises';
import { dshHomePath } from '@deepseek-ai/dsh-home-paths';
import { readStatus } from './status.mjs';

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
}
