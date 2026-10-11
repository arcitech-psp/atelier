#!/usr/bin/env node
// Atelier updates from a terminal (Linux, WSL, or Windows): the same steps as Settings > About and updates.
//   node cli.mjs status | check | install | rollback | cancel | auto on|off
// Atelier contacts GitHub only for `check` and `install`, or later on its own if you turn `auto on`.
import * as updater from './updater.mjs';

const [command = 'status', arg] = process.argv.slice(2);
const ctx = updater.context();
const print = line => process.stdout.write(`${line}\n`);
const describe = () => {
  const s = updater.installState(ctx);
  print(`Atelier ${ctx.plain} (powered by DSH ${ctx.dshVersion}), ${ctx.mode === 'installed' ? `installed in ${ctx.installRoot}` : 'running from source'}`);
  if (ctx.mode === 'installed') print(`  current ${s.current}; previous ${s.previous ?? 'none'}; pending ${s.pending ?? 'none'}; kept ${s.versions.join(', ') || 'none'}`);
  print(`  automatic updates: ${updater.readConfig(ctx).auto ? 'on' : 'off'}; releases from github.com/${ctx.repo}`);
};
try {
  if (command === 'status') describe();
  else if (command === 'check' || command === 'install') {
    const result = await updater.check(ctx);
    if (!result.newer) print(`You have the newest version (${result.latest?.version ?? ctx.plain}).`);
    else {
      print(`Atelier ${result.latest.version} is available: ${result.latest.page}`);
      if (command === 'install') {
        let last = 0;
        await updater.install(ctx, result.latest, {onProgress: ({bytes}) => {
          if (bytes - last > 25 * 1048576) { last = bytes; process.stdout.write(`  ${(bytes / 1048576).toFixed(0)} MB\n`); }
        }});
        print(`Installed and verified. Atelier ${result.latest.version} starts next time (atelier-preview restart).`);
      }
    }
  } else if (command === 'rollback') print(`Atelier ${updater.rollback(ctx).pending} starts next time (atelier-preview restart).`);
  else if (command === 'cancel') { updater.cancelPending(ctx); print('Nothing pending.'); }
  else if (command === 'auto' && (arg === 'on' || arg === 'off')) { updater.writeConfig(ctx, {auto: arg === 'on'}); print(`Automatic updates ${arg}.`); }
  else { print('usage: status | check | install | rollback | cancel | auto on|off'); process.exitCode = 2; }
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
