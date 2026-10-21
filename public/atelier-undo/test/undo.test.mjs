import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {createTurnUndo} from '../index.mjs';

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
