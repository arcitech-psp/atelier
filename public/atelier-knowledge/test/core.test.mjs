import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {grep, read, save, validateSave} from '../core.mjs';

const note = {title: 'Timber span limit', text: 'For this example, the timber span limit is 4.2 metres when the stated conditions apply.',
  topic: 'design-guides', sources: ['https://example.org/guide']};

test('refuses a note without a valid source URL', () => {
  assert.match(validateSave({...note, sources: []}).error, /source URL/u);
  assert.match(validateSave({...note, sources: ['ftp://private.txt']}).error, /source URL/u);
});

test('a saved note is searchable and readable by a fresh caller', async t => {
  const root = await mkdtemp(join(tmpdir(), 'atelier-knowledge-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const saved = await save(note, {root});
  assert.equal(saved.ok, true);
  const results = await grep('timber 4.2 metres', {root});
  assert.equal(results.total, 1);
  assert.equal(results.results[0].id, saved.id);
  const full = await read(saved.id, {root});
  assert.equal(full.text, note.text);
  assert.equal(full.sources[0].url, 'https://example.org/guide');
});

test('an empty shelf is a valid offline search result', async t => {
  const root = await mkdtemp(join(tmpdir(), 'atelier-knowledge-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  assert.deepEqual(await grep('anything', {root}), {query: 'anything', total: 0, results: []});
});
