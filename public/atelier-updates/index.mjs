// Atelier updates: the "Updates" section in Settings (About, Check for updates, automatic updates, roll back).
// Atelier contacts GitHub only when the person presses "Check for updates" or turns automatic updates on.
import * as updater from './updater.mjs';
import {channelContext} from './channel-client.mjs';
import {applyChannel} from './channel-plugin.mjs';

export const name = 'atelier-updates';
export const inject = [];

export function apply(ctx, config = {}) {
  const channel = channelContext({...process.env, ...config.env});
  if (channel) return applyChannel(ctx, channel);
  const env = updater.context();
  const job = {state: 'idle', progress: null, error: null, lastCheck: null};
  let restarting = false;

  const status = () => {
    const config = updater.readConfig(env);
    return {
      product: 'Atelier', version: env.version, plain: env.plain, dshVersion: env.dshVersion, mode: env.mode,
      platform: env.platform, repo: env.repo, auto: config.auto === true, lastCheckAt: config.lastCheck ?? null,
      install: updater.installState(env), job: {...job},
    };
  };
  const doCheck = async () => {
    job.state = 'checking'; job.error = null;
    try { job.lastCheck = await updater.check(env); job.state = 'idle'; }
    catch (error) { job.state = 'idle'; job.error = error.message; }
    return job.lastCheck;
  };
  const doInstall = async () => {
    if (job.state === 'installing') return;
    if (!job.lastCheck?.newer) await doCheck();
    if (!job.lastCheck?.newer) return;
    job.state = 'installing'; job.error = null; job.progress = {bytes: 0, total: job.lastCheck.latest.asset.size};
    try { await updater.install(env, job.lastCheck.latest, {onProgress: p => { job.progress = p; }}); job.state = 'ready'; }
    catch (error) { job.state = 'idle'; job.error = error.message; }
  };

  // Automatic updates: only when the person turned them on. Check a minute after start, then daily; a found
  // update is downloaded, verified and installed beside the current one, and switches on the next start.
  let timer = null;
  const schedule = () => {
    clearTimeout(timer);
    if (!updater.readConfig(env).auto || env.mode !== 'installed') return;
    timer = setTimeout(async () => { await doInstall(); schedule(); }, job.lastCheck ? 24 * 3600 * 1000 : 60 * 1000);
    timer.unref?.();
  };
  schedule();
  ctx.on?.('dispose', () => clearTimeout(timer));

  ctx.inject(['connection'], ctx => ctx.effect(() => ctx.connection.rpc.handle('/atelier-updates', async (endpoint, payload) => {
    try {
      if (endpoint === 'status') return {ok: true, value: status()};
      if (endpoint === 'check') { await doCheck(); return {ok: true, value: status()}; }
      if (endpoint === 'install') { void doInstall(); return {ok: true, value: status()}; }
      if (endpoint === 'auto') {
        updater.writeConfig(env, {auto: payload?.enabled === true});
        schedule();
        return {ok: true, value: status()};
      }
      if (endpoint === 'rollback') { updater.rollback(env); return {ok: true, value: status()}; }
      if (endpoint === 'cancel') { updater.cancelPending(env); if (job.state === 'ready') job.state = 'idle'; return {ok: true, value: status()}; }
      if (endpoint === 'restart') {
        if (env.mode !== 'installed') throw Error('Restart Atelier yourself: this copy was started from a terminal.');
        if (!restarting) {
          restarting = true;
          // The launcher sees exit code 75, switches to the pending version and starts Atelier again.
          setTimeout(() => process.exit(updater.RESTART_EXIT_CODE), 400);
        }
        return {ok: true, value: status()};
      }
      throw Error('Unknown updates operation.');
    } catch (error) {
      return {ok: false, error: {code: 'bad-request', message: error.message}};
    }
  })));
}
