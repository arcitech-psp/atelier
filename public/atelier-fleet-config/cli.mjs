#!/usr/bin/env node
import {readFile, writeFile} from 'node:fs/promises';
import {createCatalogServer, rollbackManagedFragment, updateManagedFragment} from './index.mjs';

const [command, ...args] = process.argv.slice(2);
const option = (name, fallback) => { const index = args.indexOf(name); return index < 0 ? fallback : args[index + 1]; };
const fragmentPath = option('--fragment', 'managed-fleet-config.json');
const logPath = option('--log', `${fragmentPath}.jsonl`);

if (command === 'update' || command === 'watch') {
  const url = option('--url', process.env.ATELIER_CONFIG_URL);
  if (!url) throw new Error('set --url or ATELIER_CONFIG_URL');
  const interval = Number(option('--interval', '600')) * 1000;
  do {
    try { console.log(await updateManagedFragment({url, fragmentPath, logPath}) ? 'updated' : 'unchanged'); }
    catch (error) { console.error(error.message); if (command === 'update') process.exitCode = 1; }
    if (command === 'watch') await new Promise(resolve => setTimeout(resolve, interval));
  } while (command === 'watch');
} else if (command === 'rollback') {
  console.log(`restored ${await rollbackManagedFragment({fragmentPath, logPath})}`);
} else if (command === 'serve') {
  const configPath = option('--config', 'fleet-config.json');
  const statePath = option('--state', 'fleet-config-state.json');
  const port = Number(option('--port', '8420'));
  const catalog = createCatalogServer({configPath, statePath, port});
  await catalog.start(); console.log(`catalog listening on ${port}`);
} else {
  console.error('usage: cli.mjs <serve|update|watch|rollback> [options]'); process.exitCode = 2;
}
