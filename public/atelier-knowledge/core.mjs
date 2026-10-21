import {randomUUID} from 'node:crypto';
import {mkdir, readFile, readdir, rename, rm, writeFile} from 'node:fs/promises';
import {basename, join, relative, resolve, sep} from 'node:path';

const MAX_TITLE = 140;
const MAX_TEXT = 12000;
const MAX_SOURCES = 8;
const MAX_RESULTS = 20;
const TOPIC = /^[a-z0-9][a-z0-9-]{0,59}$/u;

function cleanText(value) { return typeof value === 'string' ? value.trim() : ''; }

export function validateSave(args = {}) {
  const title = cleanText(args.title);
  const text = cleanText(args.text);
  const topic = cleanText(args.topic).toLowerCase();
  if (title.length < 4) return {error: 'Title must be at least 4 characters.'};
  if (text.length < 40) return {error: 'Text must be at least 40 characters.'};
  if (!TOPIC.test(topic)) return {error: 'Topic must use lowercase letters, numbers and hyphens (up to 60 characters).'};
  const inputs = Array.isArray(args.sources) ? args.sources : [];
  const sources = inputs.slice(0, MAX_SOURCES).map(source => {
    const item = typeof source === 'string' ? {url: source} : source;
    if (!item || typeof item !== 'object') return null;
    let url;
    try { url = new URL(String(item.url ?? '')); } catch { return null; }
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return {url: url.href, ...(item.date ? {date: String(item.date).slice(0, 40)} : {}), ...(item.title ? {title: String(item.title).trim().slice(0, 120)} : {})};
  }).filter(Boolean);
  if (!sources.length) return {error: 'Add at least one valid HTTP or HTTPS source URL.'};
  if (inputs.length > MAX_SOURCES) return {error: `Use no more than ${MAX_SOURCES} source URLs.`};
  return {note: {id: randomUUID(), title: title.slice(0, MAX_TITLE), text: text.slice(0, MAX_TEXT), topic,
    sources, createdAt: new Date().toISOString()}};
}

async function noteFiles(root) {
  let topics;
  try { topics = await readdir(root, {withFileTypes: true}); } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const files = [];
  for (const topic of topics) {
    if (!topic.isDirectory() || !TOPIC.test(topic.name)) continue;
    let entries;
    try { entries = await readdir(join(root, topic.name), {withFileTypes: true}); } catch { continue; }
    for (const entry of entries) if (entry.isFile() && /^[a-f0-9-]+\.json$/u.test(entry.name)) files.push(join(root, topic.name, entry.name));
  }
  return files;
}

async function loadNotes(root) {
  const files = await noteFiles(root);
  const notes = await Promise.all(files.map(async file => {
    try {
      const note = JSON.parse(await readFile(file, 'utf8'));
      return note && typeof note.id === 'string' && typeof note.title === 'string' && typeof note.text === 'string'
        ? {...note, path: relative(root, file).split(sep).join('/')} : null;
    } catch { return null; }
  }));
  return notes.filter(Boolean);
}

export async function save(args, {root, now = () => new Date()} = {}) {
  const result = validateSave(args);
  if (result.error) return {ok: false, error: result.error};
  const note = {...result.note, createdAt: now().toISOString()};
  const dir = join(resolve(root), note.topic);
  await mkdir(dir, {recursive: true});
  const file = join(dir, `${note.id}.json`);
  const temp = `${file}.${process.pid}.pending`;
  try {
    await writeFile(temp, `${JSON.stringify(note, null, 2)}\n`, {flag: 'wx'});
    await rename(temp, file);
  } catch (error) {
    await rm(temp, {force: true}).catch(() => {});
    throw error;
  }
  return {ok: true, id: note.id, topic: note.topic, saved: `${note.topic}/${basename(file)}`};
}

const terms = query => cleanText(query).toLocaleLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [];

export async function grep(query, {root, topic, limit = 8} = {}) {
  const words = [...new Set(terms(query))];
  if (!words.length) return {query: cleanText(query), total: 0, results: []};
  const notes = await loadNotes(resolve(root));
  const matches = notes.map(note => {
    if (topic && note.topic !== topic) return null;
    const haystack = `${note.title}\n${note.topic}\n${note.text}\n${(note.sources ?? []).map(s => `${s.title ?? ''} ${s.url}`).join('\n')}`.toLocaleLowerCase();
    const score = words.reduce((sum, word) => sum + (haystack.includes(word) ? 1 : 0), 0);
    return score ? {note, score} : null;
  }).filter(Boolean).sort((a, b) => b.score - a.score || b.note.createdAt.localeCompare(a.note.createdAt) || a.note.title.localeCompare(b.note.title));
  const count = Math.max(1, Math.min(MAX_RESULTS, Number.isInteger(limit) ? limit : 8));
  return {query: cleanText(query), total: matches.length, results: matches.slice(0, count).map(({note, score}) => ({
    id: note.id, title: note.title, topic: note.topic, score, excerpt: note.text.slice(0, 500), sources: note.sources ?? [], createdAt: note.createdAt,
  }))};
}

export async function read(id, {root} = {}) {
  const wanted = cleanText(id);
  if (!wanted || wanted.includes('/') || wanted.includes('\\')) return {ok: false, error: 'Provide a note id returned by knowledge_grep.'};
  const notes = await loadNotes(resolve(root));
  const note = notes.find(item => item.id === wanted);
  if (!note) return {ok: false, error: 'Note not found. Search with knowledge_grep first.'};
  const {path, ...value} = note;
  return {ok: true, ...value};
}
