#!/usr/bin/env node
// Preparing a mirror never pushes. The owner explicitly runs --execute after reviewing the plan.
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {assertPublicText, canonical, hash, readJson, verifyRelease} from './release.mjs';

const run = (command, args) => new Promise((done, reject) => {
  const p = spawn(command, args, {windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
  let output = ''; p.stdout.on('data', data => { output += data; });
  p.stderr.on('data', () => {});
  p.on('error', reject); p.on('close', code => code === 0 ? done(output) : reject(Error(`${command} failed; no further publication attempted.`)));
});
export async function prepareMirror({directory, repo, publicKey, output}) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw Error('Supply an existing repository as owner/name.');
  const envelope = await readJson(join(directory, 'manifest.json'));
  const m = verifyRelease(envelope, publicKey, envelope.manifest.channel);
  const objects = new Map(m.files.filter(f => !f.link).map(f => [f.sha256, f]));
  for (const [digest, file] of objects) {
    const data = await readFile(join(directory, 'objects', digest));
    if (hash(data) !== digest || data.length !== file.size) throw Error('Mirror artifact checksum mismatch.');
    if (m.channel === 'public' && file.kind !== 'dependency') assertPublicText(data.toString('latin1'));
  }
  const bundle = join(resolve(output), `${m.channel}-${m.version}.tar.gz`);
  await run('tar', ['-czf', bundle, '-C', resolve(directory), 'manifest.json', 'objects']);
  const sha = createHash('sha256'); for await (const data of createReadStream(bundle)) sha.update(data);
  const sums = join(resolve(output), 'SHA256SUMS');
  await writeFile(sums, `${sha.digest('hex')}  ${m.channel}-${m.version}.tar.gz\n${hash(await readFile(join(directory, 'manifest.json')))}  manifest.json\n`);
  return {repo, visibility: m.channel === 'dev' ? 'PRIVATE' : 'PUBLIC', tag: `${m.channel}/v${m.version}`, bundle, sums,
    manifest: join(resolve(directory), 'manifest.json'), manifestHash: hash(canonical(m))};
}
export async function executeMirror(plan, {pushSource, runImpl = run} = {}) {
  const repo = JSON.parse(await runImpl('gh', ['repo', 'view', plan.repo, '--json', 'visibility,nameWithOwner']));
  if (repo.nameWithOwner !== plan.repo || repo.visibility !== plan.visibility) throw Error('Repository visibility does not match this channel. Nothing was pushed.');
  if (pushSource) {
    if (!/^[A-Za-z0-9._/-]+$/.test(pushSource) || pushSource.startsWith('-') || pushSource.includes('..')) throw Error('Unsafe source branch.');
    await runImpl('git', ['push', `https://github.com/${plan.repo}.git`, `HEAD:refs/heads/${pushSource}`]);
  }
  // Existing repositories only. No command here creates a repository.
  await runImpl('gh', ['release', 'create', plan.tag, '--repo', plan.repo, '--title', plan.tag,
    '--notes', `Signed channel release. Manifest SHA-256: ${plan.manifestHash}.`, plan.bundle, plan.manifest, plan.sums]);
  return {published: plan.tag};
}
export async function main(args = process.argv.slice(2), env = process.env) {
  const [directory, repo] = args;
  if (!directory || !repo || !env.ATELIER_RELEASE_KEY_FILE) throw Error('Usage: github-mirror.mjs RELEASE_DIR owner/repo [--execute] [--push-source branch]; pin ATELIER_RELEASE_KEY_FILE.');
  const output = await mkdtemp(join(tmpdir(), 'atelier-channel-mirror-'));
  const plan = await prepareMirror({directory, repo, publicKey: await readFile(env.ATELIER_RELEASE_KEY_FILE, 'utf8'), output});
  if (args.includes('--execute')) return executeMirror(plan, {pushSource: args.includes('--push-source') ? args[args.indexOf('--push-source') + 1] : undefined});
  return {prepared: true, ...plan, instruction: 'Review this plan, then the owner runs the same command with --execute.'};
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().then(value => process.stdout.write(`${JSON.stringify(value)}\n`), () => { process.stderr.write('Mirror preparation/publication failed. Check signature, payload and repository visibility.\n'); process.exitCode = 1; });
