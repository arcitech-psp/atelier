#!/usr/bin/env node
// Put the `atelier` command on PATH for an installed Atelier. For the installers (packaging/), not for people:
//
//   Windows:  node install-shims.mjs --install-root "%LOCALAPPDATA%\Programs\Atelier-Preview"
//             writes <root>\bin\atelier.cmd and atelier.ps1; the installer adds <root>\bin to the user PATH.
//   Linux/WSL: node install-shims.mjs --install-root ~/.local/share/atelier-preview --bin-dir ~/.local/bin
//             writes ~/.local/bin/atelier (mode 755).
//   Either:   --remove  deletes only the shims this script wrote.
// The shims read <root>/current each time, so updates and rollbacks keep working without rewriting them.
import {chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = name => { const i = argv.indexOf(name); return i < 0 ? undefined : argv[i + 1]; };
const root = flag('--install-root');
if (!root) { console.error('usage: install-shims.mjs --install-root <dir> [--bin-dir <dir>] [--remove]'); process.exit(2); }
const windows = process.platform === 'win32';
const bin = resolve(flag('--bin-dir') ?? join(root, 'bin'));
const targets = windows ? ['atelier.cmd', 'atelier.ps1'] : ['atelier'];

if (argv.includes('--remove')) {
  for (const name of targets) {
    const file = join(bin, name);
    if (existsSync(file) && readFileSync(file, 'utf8').includes('Atelier by ARCITECH: the "atelier" command')) rmSync(file);
  }
  console.log(`[atelier] removed the atelier command from ${bin}`);
  process.exit(0);
}

mkdirSync(bin, {recursive: true});
if (windows) {
  // Templates locate the install root relative to themselves (<root>\bin\..), so they are copied as they are.
  for (const name of targets) copyFileSync(join(here, 'shims', name), join(bin, name));
} else {
  const text = readFileSync(join(here, 'shims', 'atelier.sh'), 'utf8').replace('@ROOT@', resolve(root).replace(/(["$`\\])/g, '\\$1'));
  writeFileSync(join(bin, 'atelier'), text);
  chmodSync(join(bin, 'atelier'), 0o755);
}
console.log(`[atelier] the atelier command is in ${bin}`);
const onPath = (process.env.PATH ?? '').split(windows ? ';' : ':').some(p => p && resolve(p).toLowerCase() === bin.toLowerCase());
if (!onPath) console.log(`[atelier] ${bin} is not on PATH yet${windows ? ' (the installer adds it to your user PATH)' : '; open a new terminal or add it to PATH'}.`);
