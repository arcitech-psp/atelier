// Atelier Brains, host half. Serves GET /api/atelier-brains (what is loaded now, read from the real servers) and
// POST /api/atelier-brains/{load|unload|reload} {machine, brainId}. What may be started or stopped is decided only by
// brains.json; the browser can not send a command. The page is client.js (Settings > Brains).
//
// config.configPath  where brains.json lives (default: <Atelier home>/atelier-brains/brains.json)
// config.routes      false when another plugin already serves the route with its own live readers
//                    (the ARCITECH harness serves it from Mission Control, which already samples its machines)
import {copyFileSync, existsSync, mkdirSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {configuredManager, createBrainsHandler, genericLive, ROUTE} from './core.mjs';

// The home-folder helper exists in the Atelier harness; a host without it passes config.configPath instead.
const homePaths = await import('@deepseek-ai/dsh-home-paths').catch(() => null);

export const name = 'atelier-brains';
export const inject = [];

export function apply(ctx, config = {}) {
  if (config.routes === false) return;
  ctx.inject(['connection', 'webServer'], scope => {
    const home = config.home ?? homePaths?.dshHomePath('atelier-brains');
    const path = config.configPath ?? (home ? join(home, 'brains.json') : null);
    if (!path) { ctx.logger?.warn?.('atelier-brains: no place for brains.json (set configPath)'); return; }
    const auditFile = join(dirname(path), 'brains-actions.jsonl');
    // Leave the example next to where brains.json goes, so a person finds it without hunting through the install.
    try {
      mkdirSync(dirname(path), {recursive: true});
      const example = join(dirname(path), 'brains.example.json');
      if (!existsSync(example)) copyFileSync(fileURLToPath(new URL('./brains.example.json', import.meta.url)), example);
    } catch { /* the folder is created when first needed */ }
    const getManager = configuredManager({path, live: genericLive(), auditFile});
    scope.effect(() => scope.webServer.register({
      kind: 'prefix', path: ROUTE,
      handler: createBrainsHandler({authorizeIndex: (req, res) => scope.connection.authorizeIndex(req, res), getManager}),
    }));
  });
}
