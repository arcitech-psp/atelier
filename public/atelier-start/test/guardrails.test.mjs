// Atelier guardrails (guardrails.mjs): the setting, the sandbox preset of every chat and the approval answer, with
// guardrails on (the default) and off. Runs with Node alone: `node --test public/atelier-start/test/`.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  GUARDRAILS_NS, OFF_PRESET, WARNING, alignSession, answerApproval, applyGuardrails, guardrailsState, lastPreset, offFromSettings, syncOffPreset,
} from '../guardrails.mjs';
import {isManagementPath} from '../bottega/gateway.mjs';
import {WARNING as CLI_WARNING, readGuardrails, setGuardrails} from '../../atelier-cli/src/guardrails.mjs';
import {parseArgs} from '../../atelier-cli/src/args.mjs';

/** A stand-in for the harness permission service: the same preset table, fold and write path, in miniature. */
function fakePresets() {
  const presets = {
    'read-only': {sandbox: 'read-only', approval: 'ask'},
    'workspace-write': {sandbox: 'workspace-write', approval: 'ask'},
    'danger-full-access': {sandbox: 'danger-full-access', approval: 'never'},
  };
  const knobs = events => {
    let preset = null, sandbox = 'workspace-write', approval = 'ask';
    for (const e of events) {
      if (e.type === 'permission/preset') preset = e.data.preset;
      if (e.type === 'sandbox/mode') sandbox = e.data.mode;
      if (e.type === 'approval/policy') approval = e.data.policy;
    }
    return {preset, sandbox, approval};
  };
  return {
    presets, defaultPreset: 'workspace-write',
    get names() { return Object.keys(presets); },
    knobs,
    current(events) {
      const k = knobs(events);
      const match = spec => spec.sandbox === k.sandbox && spec.approval === k.approval;
      if (k.preset && presets[k.preset] && match(presets[k.preset])) return k.preset;
      return Object.entries(presets).find(([, spec]) => match(spec))?.[0] ?? 'custom';
    },
    set(session, name) {
      const spec = presets[name];
      if (!spec) throw Error(`unknown preset "${name}"`);
      const k = knobs(session.events);
      session.append('permission/preset', {preset: name});
      if (spec.sandbox !== k.sandbox) session.append('sandbox/mode', {mode: spec.sandbox});
      if (spec.approval !== k.approval) session.append('approval/policy', {policy: spec.approval});
    },
  };
}
const fakeSession = (events = []) => ({events, append(type, data) { this.events.push({type, data}); }});

/** Just enough of a cordis context for applyGuardrails: services, events, effects and a settings section. */
function fakeHost() {
  const listeners = {};
  let stored, watcher;
  const sessions = [];
  const ctx = {
    fiber: {state: 0},
    logger: {info() {}, warn() {}},
    permissionPresets: fakePresets(),
    sessions: {list: () => sessions},
    approval: {},
    settings: {
      register: (ns, schema, {base}) => ({get: () => schema(stored ?? base), watch: fn => { watcher = fn; }}),
      mutate: async (ns, ops) => { stored = {...stored}; for (const op of ops) stored[op.path[0]] = op.value; watcher?.(); },
    },
    get: name => ctx[name],
    inject(names, fn) { if (names.every(n => n in ctx)) fn(ctx); },
    effect(fn) { fn(); },
    on(event, fn, options) { (listeners[event] ??= [])[options?.prepend ? 'unshift' : 'push'](fn); return () => {}; },
  };
  return {
    ctx, sessions,
    setStored: value => { stored = value; watcher?.(); },
    newSession(events = []) { const s = fakeSession(events); sessions.push(s); for (const fn of listeners['session/created'] ?? []) fn(s); return s; },
    ask: () => listeners['approval/request'][0]({toolName: 'bash'}, async () => 'asked-the-person'),
  };
}

test('the warning is the same words in the app, the confirmation dialog and the terminal', () => {
  const client = readFileSync(fileURLToPath(new URL('../client.js', import.meta.url)), 'utf8');
  const quoted = client.match(/const GUARDRAILS_WARNING = ((?:'[^']*'\s*\+?\s*)+);/)?.[1];
  assert.ok(quoted, 'client.js defines GUARDRAILS_WARNING');
  assert.equal(quoted.match(/'([^']*)'/g).map(part => part.slice(1, -1)).join(''), WARNING);
  assert.equal(CLI_WARNING, WARNING);
  assert.match(client, /'Keep guardrails on'/);
  assert.match(client, /'Turn off guardrails'/);
  assert.match(client, /'Guardrails off'/);
});

test('guardrails are on unless the setting says enabled: false', () => {
  assert.equal(String(GUARDRAILS_NS), 'atelier-guardrails');
  assert.equal(offFromSettings(undefined), false);
  assert.equal(offFromSettings({}), false);
  assert.equal(offFromSettings({enabled: true}), false);
  assert.equal(offFromSettings({enabled: 'no'}), false);
  assert.equal(offFromSettings({enabled: false}), true);
});

test('approvals: shown to the person while on, answered yes at once while off', async () => {
  let asked = 0;
  const next = async () => { asked += 1; return 'unavailable'; };
  assert.equal(await answerApproval({off: false}, next), 'unavailable');
  assert.equal(asked, 1);
  assert.equal(await answerApproval({off: true}, next), 'allowed-once');
  assert.equal(asked, 1, 'no prompt while guardrails are off');
});

test('sandbox: a chat follows the switch, and a preset the person chose is kept when guardrails come back on', () => {
  const presets = fakePresets();
  const chat = fakeSession();
  presets.set(chat, 'workspace-write');
  assert.equal(alignSession(presets, chat, false), undefined, 'on: nothing changes');
  assert.equal(presets.knobs(chat.events).sandbox, 'workspace-write');

  syncOffPreset(presets, true);
  assert.ok(presets.names.includes(OFF_PRESET));
  assert.equal(alignSession(presets, chat, true), OFF_PRESET);
  assert.deepEqual(presets.knobs(chat.events), {preset: OFF_PRESET, sandbox: 'danger-full-access', approval: 'ask'});
  assert.equal(alignSession(presets, chat, true), undefined, 'already off: no new events');

  assert.equal(alignSession(presets, chat, false), 'workspace-write');
  syncOffPreset(presets, false);
  assert.ok(!presets.names.includes(OFF_PRESET), 'the preset is only listed while guardrails are off');
  assert.deepEqual(presets.knobs(chat.events), {preset: 'workspace-write', sandbox: 'workspace-write', approval: 'ask'});

  const readOnly = fakeSession();
  presets.set(readOnly, 'read-only');
  assert.equal(alignSession(presets, readOnly, false), undefined);
  assert.equal(lastPreset(readOnly.events), 'read-only');
});

test('end to end: on by default, off after the setting changes, back on again', async () => {
  globalThis[Symbol.for('arcitech.atelier.guardrails')] = undefined;
  const host = fakeHost();
  const before = host.newSession();
  host.ctx.permissionPresets.set(before, 'workspace-write');
  applyGuardrails(host.ctx);
  const state = guardrailsState();

  // On (default): today's behaviour.
  assert.equal(state.off, false);
  assert.equal(await host.ask(), 'asked-the-person');
  assert.equal(host.ctx.permissionPresets.knobs(before.events).sandbox, 'workspace-write');
  const fresh = host.newSession();
  host.ctx.permissionPresets.set(fresh, 'workspace-write');
  assert.equal(host.ctx.permissionPresets.knobs(fresh.events).sandbox, 'workspace-write');

  // Off: every open chat and every new chat gets full access, approvals are answered without asking.
  const seen = [];
  state.listeners.add(off => seen.push(off));
  host.setStored({enabled: false});
  assert.equal(state.off, true);
  assert.deepEqual(seen, [true]);
  assert.equal(await host.ask(), 'allowed-once');
  for (const chat of [before, fresh]) assert.equal(host.ctx.permissionPresets.knobs(chat.events).sandbox, 'danger-full-access');
  const later = host.newSession();
  assert.equal(host.ctx.permissionPresets.knobs(later.events).sandbox, 'danger-full-access');

  // On again (the Safety page's RPC path): back to the workspace sandbox and the prompts.
  await host.ctx.settings.mutate(GUARDRAILS_NS, [{op: 'set', path: ['enabled'], value: true}]);
  assert.equal(state.off, false);
  assert.equal(await host.ask(), 'asked-the-person');
  for (const chat of [before, fresh, later]) assert.equal(host.ctx.permissionPresets.knobs(chat.events).sandbox, 'workspace-write');
  assert.ok(!host.ctx.permissionPresets.names.includes(OFF_PRESET));
  globalThis[Symbol.for('arcitech.atelier.guardrails')] = undefined;
});

test('the switch channel is never forwarded to a paired Bottega device; the read-only status is', () => {
  for (const p of ['/atelier-guardrails/set', '/ATELIER-GUARDRAILS/set', '/%61telier-guardrails/set', '/api/rpc/atelier-guardrails']) assert.equal(isManagementPath(p), true, p);
  assert.equal(isManagementPath('/atelier-start/guardrails'), false);
});

test('terminal: atelier settings set guardrails on|off writes settings.yaml', async () => {
  const home = mkdtempSync(join(tmpdir(), 'atelier-guardrails-'));
  try {
    assert.equal(readGuardrails(home), true, 'on by default');
    assert.equal(await setGuardrails(home, true), false, 'already on: nothing written');
    assert.equal(await setGuardrails(home, false), true);
    assert.equal(readGuardrails(home), false);
    assert.match(readFileSync(join(home, 'settings.yaml'), 'utf8'), /atelier-guardrails:\s+enabled: false/);
    assert.equal(await setGuardrails(home, false), false);
    assert.equal(await setGuardrails(home, true), true);
    assert.equal(readGuardrails(home), true);
  } finally { rmSync(home, {recursive: true, force: true}); }
  const parsed = parseArgs(['settings', 'set', 'guardrails', 'off', '--yes-i-understand']);
  assert.deepEqual([parsed.command, parsed.action, parsed.args, parsed.options['yes-i-understand']], ['settings', 'set', {name: 'guardrails', value: 'off'}, true]);
  assert.equal(parseArgs(['settings']).action, 'list');
});
