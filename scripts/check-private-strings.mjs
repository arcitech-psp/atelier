#!/usr/bin/env node
// Check release source for the private markers listed by the public build rules.
import {readFile, readdir, stat} from 'node:fs/promises';
import {resolve, relative, sep} from 'node:path';
import {spawnSync} from 'node:child_process';

const DEFAULT_PATTERNS = [
  ['10.0.0', '.'].join(''), ['Users', '\\', 'parth'].join(''), ['/home', '/', 'psp'].join(''),
  ['HA', 'DES'].join(''), ['POSE', 'IDON'].join(''), ['ZE', 'US'].join(''), ['At', 'las'].join(''),
  ['Her', 'cules'].join(''), ['Hel', 'la'].join(''), ['Cal', 'gary'].join(''), ['E', 'G2'].join(''),
  ['Comfy', 'UI'].join(''), ['Cold', ' Fusion'].join(''), ['dsh-', 'ha', 'des-', 'unreal'].join(''), ['file:', '//', '/'].join(''),
];

function usage() {
  process.stderr.write('Usage: node scripts/check-private-strings.mjs [--root DIR] [--list FILE] [--all] [FILE ...]\n');
}

function parseArgs(args) {
  const options = {root: process.cwd(), list: null, files: [], all: false};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--root' && args[i + 1]) options.root = resolve(args[++i]);
    else if (args[i] === '--list' && args[i + 1]) options.list = resolve(args[++i]);
    else if (args[i] === '--all') options.all = true;
    else if (args[i] === '--help') options.help = true;
    else if (args[i].startsWith('-')) throw new Error(`Unknown option: ${args[i]}`);
    else options.files.push(resolve(args[i]));
  }
  return options;
}

function escapeRegex(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function matcher(value) {
  const startsWord = /^[\p{L}\p{N}_]/u.test(value);
  const endsWord = /[\p{L}\p{N}_]$/u.test(value);
  return new RegExp(`${startsWord ? '(?<![\\p{L}\\p{N}_])' : ''}${escapeRegex(value)}${endsWord ? '(?![\\p{L}\\p{N}_])' : ''}`, 'iu');
}

async function readPatterns(path) {
  if (!path) return DEFAULT_PATTERNS;
  return (await readFile(path, 'utf8')).split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#'));
}

function addedLines(root) {
  const base = 'release/20261018-fixes';
  let result = spawnSync('git', ['diff', '--unified=0', `${base}...`], {cwd: root, encoding: 'utf8', maxBuffer: 16 << 20});
  if (result.status !== 0) result = spawnSync('git', ['diff', '--unified=0', 'HEAD'], {cwd: root, encoding: 'utf8', maxBuffer: 16 << 20});
  if (result.status !== 0) return null;
  const rows = [];
  let file = '', line = 0;
  for (const text of result.stdout.split(/\r?\n/)) {
    if (text.startsWith('+++ b/')) { file = text.slice(6); continue; }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(text);
    if (hunk) { line = Number(hunk[1]); continue; }
    if (text.startsWith('+') && !text.startsWith('+++')) rows.push({file, row: line++, text: text.slice(1)});
    else if (text.startsWith(' ')) line++;
  }
  return rows;
}

function untrackedFiles(root) {
  const result = spawnSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], {cwd: root, encoding: 'buffer'});
  return result.status === 0 ? result.stdout.toString('utf8').split('\0').filter(Boolean).map(path => resolve(root, path)) : [];
}

async function allFiles(root) {
  const files = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, {withFileTypes: true})) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const path = resolve(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) files.push(path);
    }
  }
  await walk(root);
  return files;
}

async function main() {
  let options;
  try { options = parseArgs(process.argv.slice(2)); }
  catch (error) { process.stderr.write(`${error.message}\n`); usage(); process.exitCode = 2; return; }
  if (options.help) { usage(); return; }
  const patterns = await readPatterns(options.list);
  const rules = patterns.map((value, index) => ({index: index + 1, value, regex: matcher(value)}));
  const findings = [];
  let rows;
  if (options.files.length) {
    rows = [];
    for (const file of options.files) {
      let content;
      try { content = await readFile(file, 'utf8'); } catch { continue; }
      content.split(/\r?\n/).forEach((text, index) => rows.push({file, row: index + 1, text}));
    }
  } else if (options.all) {
    rows = [];
    for (const file of await allFiles(options.root)) {
      let content;
      try { content = await readFile(file, 'utf8'); } catch { continue; }
      content.split(/\r?\n/).forEach((text, index) => rows.push({file, row: index + 1, text}));
    }
  } else {
    rows = addedLines(options.root);
    if (rows === null) {
      rows = [];
      for (const file of await allFiles(options.root)) {
        let content;
        try { content = await readFile(file, 'utf8'); } catch { continue; }
        content.split(/\r?\n/).forEach((text, index) => rows.push({file, row: index + 1, text}));
      }
    } else {
      for (const file of untrackedFiles(options.root)) {
        let content;
        try { content = await readFile(file, 'utf8'); } catch { continue; }
        content.split(/\r?\n/).forEach((text, index) => rows.push({file, row: index + 1, text}));
      }
    }
  }
  const scanned = rows.filter(item => !options.list || resolve(item.file) !== options.list);
  for (const item of scanned) {
    const file = resolve(item.file);
    let info;
    try { info = await stat(file); } catch { continue; }
    if (!info.isFile()) continue;
    for (const rule of rules) if (rule.regex.test(item.text)) findings.push({file, row: item.row, rule: rule.index});
  }
  if (findings.length) {
    process.stderr.write(`Private string check failed: ${findings.length} match${findings.length === 1 ? '' : 'es'} in ${new Set(findings.map(item => item.file)).size} file(s).\n`);
    for (const item of findings) process.stderr.write(`  ${relative(options.root, item.file).split(sep).join('/')}:${item.row} (rule ${item.rule})\n`);
    process.exitCode = 1;
  } else process.stdout.write(`Private string check passed: ${scanned.length} lines, ${rules.length} rules, 0 matches.\n`);
}

main().catch(error => { process.stderr.write(`Private string check error: ${error.message}\n`); process.exitCode = 2; });
