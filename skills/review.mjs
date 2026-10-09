#!/usr/bin/env node
// Review a contributed skill before it is listed. No dependencies beyond Node 24.
//   node skills/review.mjs <skill-folder>            print a one-page summary and any blocking problems
//   node skills/review.mjs <skill-folder> --approve  record the folder's sha256 in skills/APPROVED.json (maintainer only)
//   node skills/review.mjs --check                   verify every approved entry still matches its files
// A skill is a folder with SKILL.md (YAML frontmatter: name, description, optional whenToUse, metadata.atelier) and optional
// reference files. Listing is for approved skills only; a changed file drops a skill back to unreviewed.
import {readFileSync, writeFileSync, readdirSync, statSync, existsSync} from 'node:fs';
import {join, basename, dirname, relative} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const APPROVED = join(here, 'APPROVED.json');
const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_DESCRIPTION = 240, MAX_BODY_CHARS = 12000, MAX_FOLDER_BYTES = 512 * 1024;

const args = process.argv.slice(2);
const flag = f => args.includes(f);
const target = args.find(a => !a.startsWith('--'));

/** Minimal frontmatter reader: `key: value`, nested maps by two-space indent, `- item` lists, quoted or plain scalars. */
function parseFrontmatter(text) {
  const lines = text.split(/\r?\n/);
  const root = {};
  const stack = [{indent: -1, obj: root}];
  let lastKey = null, lastObj = root;
  for (const raw of lines) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const indent = raw.length - raw.trimStart().length;
    const line = raw.trim();
    while (stack.length > 1 && indent <= stack.at(-1).indent) stack.pop();
    const parent = stack.at(-1).obj;
    if (line.startsWith('- ')) {
      if (!Array.isArray(lastObj[lastKey])) lastObj[lastKey] = [];
      lastObj[lastKey].push(unquote(line.slice(2)));
      continue;
    }
    const m = /^([A-Za-z0-9_-]+):(.*)$/.exec(line);
    if (!m) throw Error(`cannot parse frontmatter line: ${line}`);
    const [, key, rest] = m;
    const value = rest.trim();
    if (value === '' ) { parent[key] = {}; stack.push({indent, obj: parent[key]}); lastKey = key; lastObj = parent; }
    else if (value === '[]') { parent[key] = []; lastKey = key; lastObj = parent; }
    else if (/^\[.*\]$/.test(value)) { parent[key] = value.slice(1, -1).split(',').map(s => unquote(s.trim())).filter(Boolean); lastKey = key; lastObj = parent; }
    else { parent[key] = unquote(value); lastKey = key; lastObj = parent; }
  }
  return root;
}
const unquote = s => { s = String(s).trim(); if ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"'))) return s.slice(1, -1).replace(/''/g, "'"); if (s === 'true') return true; if (s === 'false') return false; if (/^\d+$/.test(s)) return Number(s); return s; };

function files(dir) {
  const out = [];
  const walk = d => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else out.push(p); } };
  walk(dir);
  return out.sort();
}
const sha = buf => createHash('sha256').update(buf).digest('hex');
function folderHash(dir) {
  const h = createHash('sha256');
  for (const p of files(dir)) { h.update(relative(dir, p).replace(/\\/g, '/')); h.update('\0'); h.update(readFileSync(p)); h.update('\0'); }
  return h.digest('hex');
}

function review(dir) {
  const problems = [], notes = [];
  const file = join(dir, 'SKILL.md');
  if (!existsSync(file)) return {problems: ['no SKILL.md in the folder'], notes};
  const text = readFileSync(file, 'utf8');
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return {problems: ['SKILL.md has no YAML frontmatter block'], notes};
  let fm;
  try { fm = parseFrontmatter(m[1]); } catch (e) { return {problems: [e.message], notes}; }
  const body = m[2].trim();
  const name = fm.name;
  if (typeof name !== 'string' || !NAME_RE.test(name)) problems.push('name must be kebab-case (letters, digits, single dashes)');
  if (name && name !== basename(dir)) problems.push(`folder is "${basename(dir)}" but name is "${name}"`);
  if (typeof fm.description !== 'string' || !fm.description.trim()) problems.push('description is required (it is the one-line catalogue entry)');
  else if (fm.description.length > MAX_DESCRIPTION) problems.push(`description is ${fm.description.length} characters; keep it under ${MAX_DESCRIPTION}`);
  if (!body) problems.push('the body (instructions after the frontmatter) is empty');
  if (body.length > MAX_BODY_CHARS) problems.push(`body is ${body.length} characters; keep it under ${MAX_BODY_CHARS} or move detail into reference files`);
  const at = fm.metadata?.atelier ?? {};
  const tools = Array.isArray(at.tools) ? at.tools : [];
  if (at.mode && !['schema', 'proxy'].includes(at.mode)) problems.push('metadata.atelier.mode must be schema or proxy');
  if (at.keywords) { try { new RegExp(String(at.keywords), 'i'); } catch (e) { problems.push(`keywords is not a valid regex: ${e.message}`); } }
  if (at.trust && !['owner', 'approved', 'unreviewed'].includes(at.trust)) problems.push('metadata.atelier.trust must be owner, approved or unreviewed');
  // what a reviewer must look at
  const templating = [...new Set((body.match(/\{\{[^}]*\}\}/g) ?? []).filter(t => !/^\{\{(cwd|model)\}\}$/.test(t)))];
  if (templating.length) problems.push(`templating other than {{cwd}} / {{model}} is not allowed: ${templating.join(', ')}`);
  const hosts = [...new Set(body.match(/https?:\/\/[A-Za-z0-9.\-]+(?::\d+)?/g) ?? [])];
  const ips = [...new Set(body.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) ?? [])];
  const paths = [...new Set(body.match(/[A-Za-z]:\\[^\s'"`]+|\/(?:home|Users)\/[^\s'"`]+/g) ?? [])];
  const secretish = /(?:api[_-]?key|secret|passw(?:or)?d|token)\s*[:=]\s*\S{8,}/i.test(body) || /\b(?:sk|hf|ghp)_[A-Za-z0-9_-]{16,}/.test(body);
  if (secretish) problems.push('the body looks like it contains a key, token or password');
  const imperative = /\b(ignore (all |the )?(previous|above|system)|you are now|disregard)\b/i.test(body);
  if (imperative) notes.push('body contains instruction-override phrasing; read it carefully');
  const all = files(dir);
  const bytes = all.reduce((a, p) => a + statSync(p).size, 0);
  if (bytes > MAX_FOLDER_BYTES) problems.push(`folder is ${Math.round(bytes / 1024)} KB; keep it under ${MAX_FOLDER_BYTES / 1024} KB`);
  const exec = all.filter(p => /\.(mjs|js|cjs|ts|py|ps1|sh|bat|cmd|exe|dll)$/i.test(p));
  if (exec.length) problems.push(`executable or script files are not allowed in a skill: ${exec.map(p => relative(dir, p)).join(', ')}`);
  return {problems, notes, name, description: fm.description, whenToUse: fm.whenToUse, tools, keywords: at.keywords, mode: at.mode ?? 'schema',
    bodyChars: body.length, files: all.map(p => relative(dir, p).replace(/\\/g, '/')), bytes, hosts, ips, paths, hash: folderHash(dir)};
}

const loadApproved = () => existsSync(APPROVED) ? JSON.parse(readFileSync(APPROVED, 'utf8')) : {};

if (flag('--check')) {
  const approved = loadApproved();
  let bad = 0;
  for (const [name, entry] of Object.entries(approved)) {
    const dir = join(here, entry.path);
    const ok = existsSync(dir) && folderHash(dir) === entry.sha256;
    if (!ok) bad++;
    console.log(`${ok ? 'ok      ' : 'CHANGED '} ${name}  ${entry.path}`);
  }
  process.exit(bad ? 1 : 0);
}
if (!target) { console.log('usage: node skills/review.mjs <skill-folder> [--approve] | --check'); process.exit(2); }
const r = review(target);
console.log(`Skill: ${r.name ?? basename(target)}`);
if (r.description) console.log(`Catalogue line: - ${r.name}: ${r.description}`);
if (r.whenToUse) console.log(`When to use: ${r.whenToUse}`);
console.log(`Mode: ${r.mode ?? '-'}   Tools it reveals: ${r.tools?.length ? r.tools.join(', ') : 'none'}   Keywords: ${r.keywords ?? 'none'}`);
console.log(`Body: ${r.bodyChars ?? 0} characters   Files: ${r.files?.join(', ') ?? '-'}   Size: ${Math.round((r.bytes ?? 0) / 1024)} KB`);
console.log(`Hosts named: ${r.hosts?.length ? r.hosts.join(', ') : 'none'}   IPs: ${r.ips?.length ? r.ips.join(', ') : 'none'}   Paths: ${r.paths?.length ? r.paths.join(', ') : 'none'}`);
for (const n of r.notes) console.log(`note: ${n}`);
for (const p of r.problems) console.log(`PROBLEM: ${p}`);
if (r.hash) console.log(`sha256: ${r.hash}`);
if (flag('--approve')) {
  if (r.problems.length) { console.log('not approved: fix the problems first'); process.exit(1); }
  const approved = loadApproved();
  approved[r.name] = {path: relative(here, target).replace(/\\/g, '/'), sha256: r.hash, approvedAt: new Date().toISOString().slice(0, 10)};
  writeFileSync(APPROVED, JSON.stringify(approved, null, 2) + '\n');
  console.log(`approved: ${r.name} recorded in ${relative(process.cwd(), APPROVED)}`);
}
process.exit(r.problems.length ? 1 : 0);
