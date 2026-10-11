import assert from 'node:assert/strict';
import {test} from 'node:test';
import {UsageError, helpText, parseArgs} from '../src/args.mjs';
import {versionLine} from '../src/paths.mjs';

test('no arguments opens the TUI', () => {
  assert.deepEqual(parseArgs([]), {command: 'tui', options: {}, args: {}, positionals: []});
  assert.equal(parseArgs(['--session', 'session-1', '--theme', 'mono']).options.session, 'session-1');
});

test('version and help', () => {
  assert.deepEqual(parseArgs(['--version']), {version: true});
  assert.deepEqual(parseArgs(['-V']), {version: true});
  assert.deepEqual(parseArgs(['--help']), {help: true});
  assert.deepEqual(parseArgs(['help', 'roles']), {help: 'roles'});
  assert.deepEqual(parseArgs(['roles', '--help']), {help: 'roles'});
  assert.match(versionLine({plain: '0.1.0', dsh: '0.1.2-alpha.1'}), /^Atelier 0\.1\.0 by ARCITECH — powered by DSH 0\.1\.2-alpha\.1$/);
  assert.match(helpText(true, 'x'), /atelier chat/);
});

test('web takes --port and --open', () => {
  const p = parseArgs(['web', '--port', '3393', '--open']);
  assert.equal(p.command, 'web'); assert.equal(p.options.port, 3393); assert.equal(p.options.open, true);
  assert.throws(() => parseArgs(['web', '--port', '80']), UsageError);
  assert.throws(() => parseArgs(['web', '--port', 'abc']), UsageError);
  assert.throws(() => parseArgs(['web', '--port']), UsageError);
});

test('chat joins the prompt and collects options', () => {
  const p = parseArgs(['chat', '--json', 'two', 'words', '--attach', 'a.png', '--attach=b.md', '--port=3393']);
  assert.equal(p.args.prompt, 'two words');
  assert.deepEqual(p.options.attach, ['a.png', 'b.md']);
  assert.equal(p.options.json, true); assert.equal(p.options.port, 3393);
  assert.equal(parseArgs(['chat', '--', '--not-a-flag']).args.prompt, '--not-a-flag');
  assert.throws(() => parseArgs(['chat', '--bogus', 'x']), /unknown option --bogus/);
});

test('sessions actions', () => {
  assert.equal(parseArgs(['sessions']).action, 'list');
  assert.equal(parseArgs(['sessions', 'list', '--json', '--limit', '5']).options.limit, 5);
  assert.deepEqual(parseArgs(['sessions', 'open', 'session-x']).args, {id: 'session-x'});
  const e = parseArgs(['sessions', 'export', 'session-x', '--format', 'zip', '--out', 'x.zip']);
  assert.equal(e.options.format, 'zip');
  assert.throws(() => parseArgs(['sessions', 'export']), /needs an argument/);
  assert.throws(() => parseArgs(['sessions', 'export', 'x', '--format', 'pdf']), /must be one of/);
  assert.throws(() => parseArgs(['sessions', 'delete', 'x']), /unknown sessions action/);
});

test('roles set needs --url and takes --key-env', () => {
  const p = parseArgs(['roles', 'set', 'brain', '--url', 'http://localhost:8000/v1', '--model', 'm', '--key-env', 'MY_KEY', '--vision', '--context', '65536']);
  assert.deepEqual(p.args, {role: 'brain'});
  assert.equal(p.options['key-env'], 'MY_KEY'); assert.equal(p.options.vision, true); assert.equal(p.options.context, 65536);
  assert.throws(() => parseArgs(['roles', 'set', 'brain', '--model', 'm']), /needs --url/);
  assert.equal(parseArgs(['roles', 'test']).action, 'test');
  assert.deepEqual(parseArgs(['roles', 'test', 'stt']).args, {role: 'stt'});
});

test('profile use checks the name', () => {
  assert.deepEqual(parseArgs(['profile', 'use', 'vitruvius-zero']).args, {name: 'vitruvius-zero'});
  assert.throws(() => parseArgs(['profile', 'use', 'standard']), /unknown profile/);
  assert.equal(parseArgs(['profile']).action, 'list');
});

test('update and doctor', () => {
  assert.equal(parseArgs(['update']).action, 'check');
  assert.equal(parseArgs(['update', 'rollback', '--json']).options.json, true);
  assert.throws(() => parseArgs(['update', 'now']), UsageError);
  assert.equal(parseArgs(['doctor', '--json']).options.json, true);
  assert.throws(() => parseArgs(['frobnicate']), /unknown command/);
});
