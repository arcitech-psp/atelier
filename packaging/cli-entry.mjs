#!/usr/bin/env node
// The `atelier` command that installers put on PATH (Windows: bin\atelier.cmd / atelier.ps1; Linux and WSL:
// ~/.local/bin/atelier). It runs the full Atelier CLI when this version ships one (package.json "bin.atelier"),
// and always answers `atelier update ...` and `atelier version` itself, so updates work from any terminal.
import {spawn} from 'node:child_process';
import {existsSync, readFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const app = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const pkg = JSON.parse(readFileSync(join(app, 'package.json'), 'utf8'));
const updates = join(app, 'public', 'atelier-updates', 'cli.mjs');

const runNode = (script, scriptArgs) => {
  const child = spawn(process.execPath, [script, ...scriptArgs], {stdio: 'inherit', cwd: process.cwd(), env: process.env});
  child.once('exit', (code, signal) => process.exit(signal ? 1 : code ?? 1));
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
};

if (args[0] === 'update') {
  // atelier update [check|apply|rollback|status|auto on|off]   (apply = download, verify and install beside this one)
  const map = {undefined: 'check', check: 'check', apply: 'install', install: 'install', rollback: 'rollback', status: 'status', cancel: 'cancel', auto: 'auto'};
  const sub = map[args[1]];
  if (!sub) { process.stderr.write('usage: atelier update [check|apply|rollback|status|auto on|off]\n'); process.exit(2); }
  runNode(updates, [sub, ...args.slice(2)]);
} else if (args[0] === 'version' || args[0] === '--version') {
  const dsh = JSON.parse(readFileSync(join(app, 'harness', 'apps', 'cli', 'package.json'), 'utf8')).version;
  process.stdout.write(`Atelier ${pkg.version.replace(/-preview$/, '')} by ARCITECH, powered by DSH (DeepSeek Harness) ${dsh}\n`);
} else {
  // The full CLI (chat, sessions, roles, profile, doctor, web and the terminal UI) lives in public/atelier-cli.
  const cli = join('public', 'atelier-cli', 'bin', 'atelier.mjs');
  const bin = (typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.atelier) ?? (existsSync(join(app, cli)) ? cli : undefined);
  if (bin && existsSync(join(app, bin)) && resolve(app, bin) !== fileURLToPath(import.meta.url)) runNode(join(app, bin), args);
  else if (args.length === 0 || args[0] === 'web' || args[0] === 'start') runNode(join(app, 'start-preview.mjs'), ['--open', ...args.slice(1)]);
  else {
    process.stdout.write('Atelier by ARCITECH, powered by DSH (DeepSeek Harness)\n\n'
      + '  atelier                 start Atelier and open it in your browser\n'
      + '  atelier update check    look for a newer release on GitHub\n'
      + '  atelier update apply    download, verify and install it beside this version\n'
      + '  atelier update rollback go back to the previous version\n'
      + '  atelier version         show the version\n');
    process.exit(args[0] === 'help' || args[0] === '--help' ? 0 : 2);
  }
}
