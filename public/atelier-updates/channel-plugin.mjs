import {cancelChannel, channelStatus, checkChannel, configureChannel, rollbackChannel, stageChannel} from './channel-client.mjs';

/** Settings and polling use the same verified client as the command-line launcher. */
export function applyChannel(ctx, channel) {
  let timer, disposed = false, running = null, failures = 0;
  const job = {state: 'idle', error: null};
  const status = async () => ({...(await channelStatus(channel)), mode: 'channel', version: process.env.ATELIER_BUILD_VERSION ?? null, job: {...job}});
  const perform = (operation, action) => {
    if (running) return running;
    running = (async () => {
      job.state = operation; job.error = null;
      try { const result = await action(); failures = 0; return result; }
      catch { job.error = 'Update failed. Current version retained; check channel access, signing key and service health.'; failures++; }
      finally { job.state = 'idle'; running = null; }
    })();
    return running;
  };
  const check = () => perform('checking', async () => {
    const s = await checkChannel(channel);
    if (s.auto && s.latest !== s.current && s.latest !== s.pending) await stageChannel(channel);
    return s;
  });
  const schedule = delay => {
    if (disposed) return;
    timer = setTimeout(async () => { await check(); schedule(Math.min(channel.intervalMs * 2 ** Math.min(failures, 4), 3_600_000)); }, delay);
    timer.unref?.();
  };
  schedule(1000);
  ctx.on('dispose', async () => { disposed = true; clearTimeout(timer); if (running) await running; });
  ctx.inject(['connection'], child => child.effect(() => child.connection.rpc.handle('/atelier-updates', async (method, input = {}) => {
    try {
      if (method === 'check') await check();
      else if (method === 'install') await perform('installing', async () => { await checkChannel(channel); await stageChannel(channel); });
      else if (method === 'auto') await configureChannel(channel, {auto: input.enabled});
      else if (method === 'rollback') await rollbackChannel(channel);
      else if (method === 'cancel') await cancelChannel(channel);
      else if (method !== 'status') throw Error('Unknown channel update operation.');
      return {ok: true, value: await status()};
    } catch { return {ok: false, error: {code: 'channel-update', message: 'Channel operation failed; no running host was changed.'}}; }
  })));
}
