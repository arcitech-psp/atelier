#!/usr/bin/env node
// Bring a new DSH (DeepSeek Harness) release into Atelier. See docs/UPSTREAM_SYNC.md for the whole procedure.
//
//   node scripts/sync-upstream.mjs status               which DSH release Atelier is on, and which are newer
//   node scripts/sync-upstream.mjs prepare [--to TAG]   replay Atelier's changes onto TAG and build it (in .upstream-cache)
//   node scripts/sync-upstream.mjs continue             after you resolved conflicts in .upstream-cache/work: build it
//   node scripts/sync-upstream.mjs apply                copy the built harness into a new branch upstream/TAG, smoke-test, commit
//   node scripts/sync-upstream.mjs tag                  after review and merge: tag v<version> (local only; you push)
//
// It never adds a remote to this repository and never pushes. The upstream checkout lives in .upstream-cache/
// (ignored by git). harness/UPSTREAM.json records which upstream release harness/ is based on.
import {execFileSync, spawnSync} from 'node:child_process';
import {cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {dirname, join, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cache = join(repo, '.upstream-cache');
const work = join(cache, 'work');
const statePath = join(cache, 'state.json');
const upstreamFile = join(repo, 'harness', 'UPSTREAM.json');
const upstream = JSON.parse(readFileSync(upstreamFile, 'utf8'));
const [command = 'status', ...rest] = process.argv.slice(2);
const option = name => rest.includes(name) ? rest[rest.indexOf(name) + 1] : undefined;
const say = line => process.stdout.write(`${line}\n`);
const die = line => { process.stderr.write(`${line}\n`); process.exit(1); };
const git = (cwd, ...args) => execFileSync('git', args, {cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
const tryGit = (cwd, ...args) => spawnSync('git', args, {cwd, encoding: 'utf8'});
const shell = process.platform === 'win32';
const run = (cwd, cmd, args) => { const r = spawnSync(cmd, args, {cwd, stdio: 'inherit', shell}); if (r.status !== 0) die(`${cmd} ${args.join(' ')} failed in ${cwd}`); };
const state = () => existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : {};
const saveState = s => writeFileSync(statePath, JSON.stringify(s, null, 2));

// Folders of harness/ that come from upstream. Built output (lib/, dist/) is rebuilt, never merged as text.
const PATHS = upstream.paths;
const BUILT = new Set(['lib', 'dist', 'node_modules']);

const versionKey = tag => (/(\d+)\.(\d+)\.(\d+)(?:-([a-z]+)\.(\d+))?/.exec(tag) ?? []).slice(1).map((v, i) => i === 3 ? ({alpha: 0, beta: 1, rc: 2}[v] ?? 3) : Number(v ?? 9999));
const newer = (a, b) => { const [x, y] = [versionKey(a), versionKey(b)]; for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; };

function remoteTags() {
  const out = git(repo, 'ls-remote', '--tags', '--refs', upstream.repository);
  return out.split('\n').map(line => line.split('\trefs/tags/')[1]).filter(tag => tag && tag.startsWith(upstream.tagPrefix));
}

function walk(root, base = root, files = []) {
  if (!existsSync(root)) return files;
  for (const entry of readdirSync(root, {withFileTypes: true})) {
    if (BUILT.has(entry.name) || entry.isSymbolicLink()) continue;
    const path = join(root, entry.name);
    if (entry.isDirectory()) walk(path, base, files); else files.push(relative(base, path).split(sep).join('/'));
  }
  return files;
}

function ensureCache() {
  mkdirSync(cache, {recursive: true});
  if (!existsSync(join(work, '.git'))) {
    say(`Cloning ${upstream.repository} into .upstream-cache/work (blobs on demand)...`);
    run(cache, 'git', ['clone', '--filter=blob:none', '--no-checkout', upstream.repository, 'work']);
  }
  run(work, 'git', ['fetch', '--tags', '--force', 'origin']);
}

if (command === 'status') {
  const tags = remoteTags().filter(tag => newer(tag, upstream.tag)).sort((a, b) => newer(a, b) ? 1 : -1);
  say(`Atelier's harness/ is based on DSH ${upstream.tag} (${upstream.commit.slice(0, 10)}) from ${upstream.repository}.`);
  say(tags.length ? `Newer DSH releases: ${tags.join(', ')}\nNext: node scripts/sync-upstream.mjs prepare --to ${tags.at(-1)}` : 'No newer DSH release.');
} else if (command === 'prepare') {
  if (git(repo, 'status', '--porcelain', '--', 'harness')) die('harness/ has uncommitted changes; commit or stash them first.');
  const tags = remoteTags();
  const target = option('--to') ?? tags.filter(tag => newer(tag, upstream.tag)).sort((a, b) => newer(a, b) ? 1 : -1).at(-1);
  if (!target || !tags.includes(target)) die(`No such DSH release tag: ${target ?? '(none newer)'}`);
  ensureCache();
  // 1. Branch "atelier" = the upstream base + Atelier's harness sources (one commit holding all of Atelier's changes).
  run(work, 'git', ['checkout', '--force', '-B', 'atelier', upstream.tag]);
  let copied = 0;
  for (const top of PATHS) {
    for (const file of walk(join(repo, 'harness', top))) {
      const source = join(repo, 'harness', top, file);
      const dest = join(work, top, file);
      mkdirSync(dirname(dest), {recursive: true});
      cpSync(source, dest);
      copied++;
    }
  }
  run(work, 'git', ['add', '-A', ...PATHS]);
  const changed = tryGit(work, 'diff', '--cached', '--quiet').status !== 0;
  if (changed) run(work, 'git', ['-c', 'user.name=ARCITECH', '-c', 'user.email=noreply@arcitech.info', 'commit', '-q', '-m', `Atelier changes on DSH ${upstream.tag}`]);
  say(`Atelier's changes: ${copied} files compared, ${changed ? git(work, 'diff', '--stat', 'HEAD~1', 'HEAD').split('\n').at(-1) : 'none'}.`);
  saveState({target, base: upstream.tag, at: new Date().toISOString()});
  // 2. Replay that commit onto the new release. Conflicts stop here for a person to resolve.
  const rebase = tryGit(work, 'rebase', '--onto', target, upstream.tag, 'atelier');
  if (rebase.status !== 0) {
    const conflicts = tryGit(work, 'diff', '--name-only', '--diff-filter=U').stdout.trim();
    say(`\nConflicts while replaying Atelier's changes onto ${target}:\n${conflicts}\n`);
    say(`Resolve them in ${work} (edit, git add, git rebase --continue), then run: node scripts/sync-upstream.mjs continue`);
    process.exit(2);
  }
  process.argv[2] = 'continue';
  await build();
} else if (command === 'continue') {
  if (tryGit(work, 'rebase', '--show-current-patch').status === 0) die('The rebase in .upstream-cache/work is not finished (git rebase --continue).');
  await build();
} else if (command === 'apply') {
  const s = state();
  if (!s.built) die('Nothing built yet: run prepare (and continue) first.');
  if (git(repo, 'status', '--porcelain')) die('This checkout has uncommitted changes; commit or stash them first.');
  const branch = `upstream/${s.target}`;
  run(repo, 'git', ['switch', '-c', branch]);
  // Mirror each shipped package folder (sources and built output); report packages upstream added or removed.
  const shipped = new Set(PATHS.flatMap(top => walk(join(repo, 'harness', top)).map(f => `${top}/${f}`).filter(f => f.endsWith('/package.json')).map(dirname)));
  const built = new Set(PATHS.flatMap(top => walk(join(work, top)).map(f => `${top}/${f}`).filter(f => f.endsWith('/package.json')).map(dirname)));
  for (const pkg of shipped) {
    const from = join(work, pkg);
    if (!existsSync(from)) { say(`removed upstream (kept here, check it): ${pkg}`); continue; }
    for (const sub of readdirSync(from)) {
      if (sub === 'node_modules' || /^(test|tests|__tests__|fixtures|snapshots)$/.test(sub)) continue;
      rmSync(join(repo, 'harness', pkg, sub), {recursive: true, force: true});
      cpSync(join(from, sub), join(repo, 'harness', pkg, sub), {recursive: true, filter: src => !src.includes(`${sep}node_modules`)});
    }
  }
  const added = [...built].filter(pkg => !shipped.has(pkg) && !pkg.includes('test-support') && !pkg.startsWith('website'));
  if (added.length) say(`New upstream packages (not copied; add the ones Atelier needs by hand):\n  ${added.join('\n  ')}`);
  writeFileSync(upstreamFile, `${JSON.stringify({...upstream, tag: s.target, commit: git(work, 'rev-parse', `${s.target}^{commit}`), syncedAt: new Date().toISOString().slice(0, 10)}, null, 2)}\n`);
  run(repo, 'corepack', ['pnpm', 'install', '--no-frozen-lockfile']);
  const smoke = spawnSync(process.execPath, [join(repo, 'scripts', 'smoke-test.mjs')], {cwd: repo, stdio: 'inherit'});
  run(repo, 'git', ['add', '-A', 'harness', 'pnpm-lock.yaml']);
  run(repo, 'git', ['-c', 'user.name=ARCITECH', '-c', 'user.email=noreply@arcitech.info', 'commit', '-q', '-m', `Sync DSH ${s.target} (from ${s.base})`]);
  say(`\nCommitted on branch ${branch}. Smoke test: ${smoke.status === 0 ? 'passed' : 'FAILED, fix before merging'}.`);
  say('Next: review the diff, test by hand, merge into main, bump the version in package.json, then: node scripts/sync-upstream.mjs tag');
} else if (command === 'tag') {
  const version = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version.replace(/-preview$/, '');
  const tag = `v${version}`;
  if (tryGit(repo, 'rev-parse', '-q', '--verify', `refs/tags/${tag}`).status === 0) die(`Tag ${tag} exists already; bump the version in package.json first.`);
  run(repo, 'git', ['-c', 'user.name=ARCITECH', '-c', 'user.email=noreply@arcitech.info', 'tag', '-a', tag, '-m', `Atelier ${version} (DSH ${upstream.tag})`]);
  say(`Tagged ${tag} locally. Build the assets with packaging/build-release.ps1, keep them, then push the tag and publish yourself.`);
} else {
  die('usage: sync-upstream.mjs status | prepare [--to TAG] | continue | apply | tag');
}

async function build() {
  const s = state();
  say(`\nBuilding DSH ${s.target} with Atelier's changes (upstream's own toolchain: pnpm install + pnpm build)...`);
  run(work, 'corepack', ['pnpm', 'install', '--frozen-lockfile=false']);
  run(work, 'corepack', ['pnpm', 'run', 'build']);
  if (rest.includes('--upstream-tests')) run(work, 'corepack', ['pnpm', 'test']);
  saveState({...s, built: true, builtAt: new Date().toISOString()});
  say('Built. Next: node scripts/sync-upstream.mjs apply');
}
