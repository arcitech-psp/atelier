import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {MUTATING, apply, createTurnUndo} from '../index.mjs';

const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), 'atelier-undo-'));
  return {root, store: join(root, 'store'), files: join(root, 'files'), close: () => rmSync(root, {recursive: true, force: true})};
};

const execFor = (root, session) => ({arguments: {cwd: root}, agent: {session}});

test('undo restores all changed files byte-for-byte and archives both post-turn copies', async () => {
  const f = fixture();
  try {
    mkdirSync(f.files);
    const first = join(f.files, 'first.bin'), second = join(f.files, 'second.bin');
    const beforeFirst = Buffer.from([0, 1, 255, 10]), beforeSecond = Buffer.from('before\r\n', 'utf8');
    const afterFirst = Buffer.from([255, 0, 7, 128]), afterSecond = Buffer.from('after\n', 'utf8');
    writeFileSync(first, beforeFirst); writeFileSync(second, beforeSecond);
    const session = {id: 'test-session', events: [{type: 'turn/start', seq: 12, data: {turn: 3}}]};
    const undo = createTurnUndo({store: f.store});
    await undo.around(execFor(f.files, session), async () => {
      writeFileSync(first, afterFirst); writeFileSync(second, afterSecond);
    });
    const id = undo.finish('test-session:12', {session}, 3);
    assert.ok(id);
    const manifest = JSON.parse(readFileSync(join(f.store, 'turns', `${id}.json`), 'utf8'));
    assert.equal(manifest.status, 'finished');
    assert.ok(manifest.finishedAt);
    const result = undo.undo(id);
    assert.equal(result.ok, true);
    assert.deepEqual(readFileSync(first), beforeFirst);
    assert.deepEqual(readFileSync(second), beforeSecond);
    const archived = readdirSync(result.archive, {recursive: true}).filter(path => statSync(join(result.archive, path)).isFile());
    assert.equal(archived.length, 2);
    const archivedBytes = archived.map(path => readFileSync(join(result.archive, path)));
    assert.ok(archivedBytes.some(bytes => bytes.equals(afterFirst)));
    assert.ok(archivedBytes.some(bytes => bytes.equals(afterSecond)));
    assert.equal(JSON.parse(readFileSync(join(f.store, 'turns', `${id}.json`), 'utf8')).status, 'undone');
  } finally { f.close(); }
});

test('undo refuses if a file changed after the completed turn', async () => {
  const f = fixture();
  try {
    mkdirSync(f.files);
    const file = join(f.files, 'note.txt');
    writeFileSync(file, 'before');
    const session = {id: 'test-session', events: [{type: 'turn/start', seq: 1, data: {turn: 1}}]};
    const undo = createTurnUndo({store: f.store});
    await undo.around(execFor(f.files, session), async () => writeFileSync(file, 'after'));
    const id = undo.finish('test-session:1', {session}, 1);
    writeFileSync(file, 'later');
    assert.match(undo.undo(id).message, /changed since this turn/);
    assert.equal(readFileSync(file, 'utf8'), 'later');
  } finally { f.close(); }
});

test('only file-changing tools are snapshotted', () => {
  for (const name of ['write', 'edit', 'apply_patch', 'bash', 'pwsh', 'exec_command']) assert.ok(MUTATING.test(name), name);
  for (const name of ['read', 'grep', 'glob', 'web_search', 'web_fetch', 'knowledge_grep', 'todo_write'.replace('_write', ''), 'skill']) assert.ok(!MUTATING.test(name), name);
});

test('a file-targeted edit snapshots only that file, and a tool without a folder is not scanned', async () => {
  const f = fixture();
  try {
    mkdirSync(f.files);
    const target = join(f.files, 'target.txt'), neighbour = join(f.files, 'neighbour.txt');
    writeFileSync(target, 'before'); writeFileSync(neighbour, 'untouched');
    const session = {id: 's2', events: [{type: 'turn/start', seq: 5, data: {turn: 1}}]};
    const undo = createTurnUndo({store: f.store});
    await undo.around({name: 'edit', arguments: {path: target}, agent: {session}}, async () => writeFileSync(target, 'after'));
    let ran = false;
    await undo.around({name: 'bash', arguments: {command: 'true'}, agent: {session: {id: 's3', events: []}}}, async () => { ran = true; });
    assert.equal(ran, true);
    const id = undo.finish('s2:5', {session}, 1);
    const manifest = JSON.parse(readFileSync(join(f.store, 'turns', `${id}.json`), 'utf8'));
    assert.deepEqual(Object.keys(manifest.entries), [target]);
    assert.equal(undo.undo(id).ok, true);
    assert.equal(readFileSync(target, 'utf8'), 'before');
    assert.equal(readFileSync(neighbour, 'utf8'), 'untouched');
  } finally { f.close(); }
});
