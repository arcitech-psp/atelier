#!/usr/bin/env node
// Record, restore or remove the package links (symlinks / Windows junctions) that pnpm creates in node_modules.
// Installers cannot carry links, so the Windows build records them, ships plain files, and the installer restores them.
//
//   node links.mjs record  <root> <links.json>   write every link under <root> (targets must stay inside <root>)
//   node links.mjs restore <root> <links.json>   recreate the recorded links (junctions on Windows, relative symlinks elsewhere)
//   node links.mjs unlink  <root>                remove every link under <root> without touching what it points to
//   node links.mjs remove  <root>                delete <root> entirely (links first), also past the 260-character limit
import {lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, rmdirSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync, existsSync} from 'node:fs';
import {dirname, isAbsolute, join, relative, resolve, sep} from 'node:path';

// Remove one link itself (never its target). Windows junctions and directory symlinks need rmdir.
const dropLink = link => { try { unlinkSync(link); } catch { rmdirSync(link); } };

const [command, rootArg, fileArg] = process.argv.slice(2);
if (!command || !rootArg) {
  console.error('usage: links.mjs record|restore|unlink|remove <root> [links.json]');
  process.exit(2);
}
const root = resolve(rootArg);
const posix = p => p.split(sep).join('/');

function* walkLinks(dir) {
  let entries;
  try { entries = readdirSync(dir, {withFileTypes: true}); } catch { return; }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    let stat;
    try { stat = lstatSync(path); } catch { continue; }
    if (stat.isSymbolicLink()) yield path;
    else if (stat.isDirectory() && entry.name !== '.git') yield* walkLinks(path);
  }
}

if (command === 'record') {
  const links = [];
  for (const link of walkLinks(root)) {
    const raw = readlinkSync(link);
    const target = isAbsolute(raw) ? raw : resolve(dirname(link), raw);
    const rel = relative(root, target);
    if (rel.startsWith('..') || isAbsolute(rel)) throw Error(`link ${link} points outside ${root}: ${target}`);
    let dir = true;
    try { dir = statSync(link).isDirectory(); } catch { /* dangling: assume directory */ }
    links.push({path: posix(relative(root, link)), target: posix(relative(dirname(link), target)), dir});
  }
  links.sort((a, b) => a.path.localeCompare(b.path));
  writeFileSync(fileArg, JSON.stringify({version: 1, links}, null, 0));
  console.log(`recorded ${links.length} links`);
} else if (command === 'restore') {
  const {links} = JSON.parse(readFileSync(fileArg, 'utf8'));
  let made = 0;
  for (const {path, target, dir} of links) {
    const link = join(root, path);
    mkdirSync(dirname(link), {recursive: true});
    let present = false;
    try { present = lstatSync(link).isSymbolicLink(); } catch { /* absent */ }
    if (present) dropLink(link);
    const absolute = resolve(dirname(link), target);
    if (process.platform === 'win32') symlinkSync(absolute, link, dir ? 'junction' : 'file');
    else symlinkSync(target, link);
    made++;
  }
  console.log(`restored ${made} links`);
} else if (command === 'unlink') {
  if (!existsSync(root)) process.exit(0);
  let removed = 0;
  for (const link of [...walkLinks(root)]) {
    try { dropLink(link); removed++; } catch { /* leave it */ }
  }
  console.log(`removed ${removed} links`);
} else if (command === 'remove') {
  // Delete a whole folder: links first (so nothing is followed), then the files. Works past Windows' 260-character
  // path limit, which the installer's own delete does not.
  if (!existsSync(root)) process.exit(0);
  for (const link of [...walkLinks(root)]) { try { dropLink(link); } catch { /* rmSync below reports anything left */ } }
  rmSync(root, {recursive: true, force: true, maxRetries: 5, retryDelay: 300});
  console.log(`removed ${root}`);
} else {
  console.error(`unknown command ${command}`);
  process.exit(2);
}
