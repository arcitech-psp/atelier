// `atelier update`: a thin front for the Atelier updater (@arcitech/atelier-updates, public/atelier-updates), the same
// code behind Settings > About and updates and `atelier-preview update`. Atelier contacts GitHub only when you run
// `check` or `apply`.
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {APP_ROOT} from './paths.mjs';

export async function loadUpdater(appRoot = APP_ROOT) {
  const file = join(appRoot, 'public', 'atelier-updates', 'updater.mjs');
  if (!existsSync(file)) return undefined;
  return import(pathToFileURL(file).href);
}

/**
 * @param {'check'|'apply'|'rollback'} action
 * @param {{home: string, say: (line: string) => void, updater?: object}} io
 * @returns {Promise<object>} a JSON-friendly result
 */
export async function runUpdate(action, {home, say, updater}) {
  updater ??= await loadUpdater();
  if (!updater) {
    throw Object.assign(Error('This build of Atelier has no updater. Install from the GitHub Releases page to get updates, or update a source checkout with git pull and pnpm install.'), {exitCode: 3});
  }
  const ctx = updater.context({...process.env, ATELIER_HOME: home});
  if (action === 'rollback') {
    if (ctx.mode !== 'installed') throw Object.assign(Error('Rollback works for installed copies of Atelier. This one runs from source: use git to go back.'), {exitCode: 3});
    const state = updater.rollback(ctx);
    say(`Atelier ${state.pending} starts next time Atelier restarts.`);
    return {action, pending: state.pending};
  }
  const result = await updater.check(ctx);
  if (!result.newer) {
    say(`You have the newest version (${result.latest?.version ?? ctx.plain}).`);
    return {action, current: result.current, latest: result.latest?.version ?? null, newer: false};
  }
  say(`Atelier ${result.latest.version} is available: ${result.latest.page}`);
  if (action === 'check') return {action, current: result.current, latest: result.latest.version, newer: true, page: result.latest.page};
  if (ctx.mode !== 'installed') throw Object.assign(Error('This copy runs from source. Update it with git pull and pnpm install --frozen-lockfile.'), {exitCode: 3});
  let last = 0;
  await updater.install(ctx, result.latest, {onProgress: ({bytes}) => {
    if (bytes - last > 25 * 1048576) { last = bytes; say(`  ${(bytes / 1048576).toFixed(0)} MB`); }
  }});
  say(`Installed and verified. Atelier ${result.latest.version} starts next time Atelier restarts.`);
  return {action, current: result.current, installed: result.latest.version};
}
