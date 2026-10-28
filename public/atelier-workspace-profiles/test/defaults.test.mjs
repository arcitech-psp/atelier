import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ProfileDefaults, chooseProfile, installSessionDefault} from '../store.mjs';

async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), 'atelier-workspace-profile-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const file = join(dir, 'defaults.json'), defaults = new ProfileDefaults(file);
  const spaces = [{id: 'one', path: '/one'}, {id: 'two', path: '/two'}];
  const registry = {get: id => spaces.find(w => w.id === id), resolveByPath: async path => spaces.find(w => w.path === path)};
  const presets = {resolve: async id => { if (!['vitruvius', 'standard', 'clippy', 'broken'].includes(id)) throw Error('Unknown profile'); return {id, ...(id === 'broken' ? {broken: 'missing module'} : {})}; }};
  return {file, defaults, registry, presets, globalDefault: () => 'vitruvius'};
}
test('unset workspace uses public global default; dev resolves Clippy', async t => {
  const c = await setup(t);
  assert.equal((await chooseProfile({workspaceId: 'one'}, c)).agentPreset, 'vitruvius');
  assert.equal((await chooseProfile({}, {...c, globalDefault: () => 'clippy'})).agentPreset, 'clippy');
});
test('workspace creation choice and later edit are durable and independent', async t => {
  const c = await setup(t); await c.defaults.set('one', 'standard'); await c.defaults.set('two', 'clippy');
  assert.equal((await chooseProfile({workspaceId: 'one'}, c)).agentPreset, 'standard');
  assert.equal((await chooseProfile({workspaceId: 'two'}, c)).agentPreset, 'clippy');
  await c.defaults.set('one', 'vitruvius');
  const reloaded = {...c, defaults: new ProfileDefaults(c.file)};
  assert.equal((await chooseProfile({workspaceId: 'one'}, reloaded)).agentPreset, 'vitruvius');
  assert.equal((await chooseProfile({workspaceId: 'two'}, reloaded)).agentPreset, 'clippy');
});
test('cwd-only creation resolves the same workspace default', async t => {
  const c = await setup(t); await c.defaults.set('one', 'standard');
  assert.equal((await chooseProfile({cwd: '/one'}, c)).agentPreset, 'standard');
});
test('explicit chat profile and idempotent existing chat adoption remain unchanged', async t => {
  const c = await setup(t); await c.defaults.set('one', 'standard');
  const explicit = {workspaceId: 'one', agentPreset: 'clippy'}, existing = {workspaceId: 'one', sessionId: 'existing'};
  assert.strictEqual(await chooseProfile(explicit, c), explicit);
  assert.strictEqual(await chooseProfile(existing, c), existing);
});
test('clearing choice inherits global; invalid or broken profile fails clearly', async t => {
  const c = await setup(t); await c.defaults.set('one', 'standard'); await c.defaults.set('one', null);
  assert.equal((await chooseProfile({workspaceId: 'one'}, c)).agentPreset, 'vitruvius');
  await c.defaults.set('one', 'missing'); await assert.rejects(() => chooseProfile({workspaceId: 'one'}, c), /Unknown/);
  await c.defaults.set('one', 'broken'); await assert.rejects(() => chooseProfile({workspaceId: 'one'}, c), /unavailable/);
});
test('concurrent default writes preserve both workspace values', async t => {
  const c = await setup(t); await Promise.all([c.defaults.set('one', 'standard'), c.defaults.set('two', 'clippy')]);
  assert.deepEqual((await c.defaults.read()).defaults, {one: 'standard', two: 'clippy'});
});
test('adapter preserves receiver and is removed on disposal', async t => {
  const c = await setup(t); await c.defaults.set('one', 'standard');
  class Controller { async create(input) { assert.strictEqual(this, controller); return input; } }
  const controller = new Controller(), original = controller.create;
  const remove = installSessionDefault(controller, request => chooseProfile(request, c));
  assert.equal((await controller.create({workspaceId: 'one'})).agentPreset, 'standard');
  remove(); assert.strictEqual(controller.create, original); assert.equal(Object.hasOwn(controller, 'create'), false);
});
