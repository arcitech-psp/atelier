// Atelier guardrails: one switch (Settings > Safety, `atelier settings set guardrails off|on`, or settings.yaml) that is
// ON by default. On, nothing changes: chats work inside their project folder (workspace-write sandbox) and anything
// wider asks you first. Off, the model gets the full potential of this computer:
//   - new and open chats switch to the "guardrails-off" permission preset: full file access, no workspace limit;
//   - every approval question is answered "yes" at once, so commands and tools never wait for you;
//   - the long waits (a model loading, an image being generated, an IngeTrazo call) have no time limit; Stop still works.
// What stays whatever the switch says: Bottega pairing and its private-network checks, no telemetry, and the browser
// login token. Turning guardrails off asks for confirmation in the app and on the command line; turning them on never does.
//
// settings.yaml:
//   atelier-guardrails:
//     enabled: false        # guardrails off (true, or no section at all, is the default: on)
//
// Other Atelier plugins read the switch through one process-wide record (see guardrailsState), so no package has to
// depend on this one: `globalThis[Symbol.for('arcitech.atelier.guardrails')]?.off === true` means off.
import z from '@deepseek-ai/schemastery';
import {installSettingsSection, settingsNamespace} from '@deepseek-ai/dsh-settings';

export const GUARDRAILS_NS = settingsNamespace('atelier-guardrails');
/** The permission preset open chats use while guardrails are off (listed only while they are off). */
export const OFF_PRESET = 'guardrails-off';
/** "No time limit" for the waits that guardrails normally bound: one day, which a person always stops before. */
export const NO_LIMIT_MS = 24 * 60 * 60 * 1000;
/** The warning shown before guardrails are turned off, in the app and on the command line. */
export const WARNING = 'Turning off Atelier guardrails unlocks the full potential of the AI model: it can read, change and delete '
  + 'files anywhere on this computer and run any command without asking you. This could damage your computer or your '
  + 'work. Only turn this off if you understand the risk and trust the model you connected.';

const OFF_SPEC = {sandbox: 'danger-full-access', approval: 'ask', name: 'Guardrails off',
  description: 'Atelier guardrails are off (Settings > Safety): full file access, and approvals are answered yes automatically.'};
const KEY = Symbol.for('arcitech.atelier.guardrails');

/** The process-wide record every Atelier plugin reads: {off, listeners}. Created by whoever asks first. */
export function guardrailsState() {
  globalThis[KEY] ??= {off: false, listeners: new Set()};
  return globalThis[KEY];
}

/** True when a settings value means "guardrails off". Anything but an explicit false keeps them on. */
export const offFromSettings = value => value?.enabled === false;

/** The preset a session last recorded ("permission/preset" events), or undefined. */
export function lastPreset(events = []) {
  for (let i = events.length - 1; i >= 0; i -= 1) if (events[i]?.type === 'permission/preset') return events[i].data?.preset;
  return undefined;
}

/**
 * List the "guardrails-off" preset while guardrails are off, and only then, so the chat's permission menu matches the
 * switch. The harness keeps its preset table as plain data on the permission service; homes made by older versions
 * have no such row in cordis.patch.yml, so it is added here instead.
 */
export function syncOffPreset(presets, off) {
  const table = presets?.presets;
  if (!table || typeof table !== 'object') return false;
  if (off) table[OFF_PRESET] ??= {...OFF_SPEC};
  else delete table[OFF_PRESET];
  return true;
}

/** The preset a chat goes back to when guardrails are turned on again. */
const onPreset = presets => {
  const wanted = presets.defaultPreset;
  return wanted && wanted !== OFF_PRESET && presets.names.includes(wanted) ? wanted : 'workspace-write';
};

/**
 * Bring one chat in line with the switch. Off: the chat uses the guardrails-off preset. On: a chat that guardrails
 * switched off goes back to the default preset; a preset the person picked themselves is left alone.
 * @returns the preset now set, or undefined when nothing changed.
 */
export function alignSession(presets, session, off) {
  const last = lastPreset(session.events);
  if (off) {
    if (last === OFF_PRESET && presets.current(session.events) === OFF_PRESET) return undefined;
    presets.set(session, OFF_PRESET);
    return OFF_PRESET;
  }
  if (last !== OFF_PRESET) return undefined;
  const back = onPreset(presets);
  presets.set(session, back);
  return back;
}

/** The approval answerer: "yes, once" while guardrails are off; otherwise the question goes on to you as before. */
export const answerApproval = (state, next) => (state.off ? Promise.resolve('allowed-once') : next());

/** Host half: the setting, the approval answerer, the chats' presets and the RPC the Safety page uses. */
export function applyGuardrails(ctx) {
  const state = guardrailsState();
  let source = () => ({enabled: true});
  const publish = () => {
    const off = offFromSettings(source());
    if (off === state.off) return;
    state.off = off;
    ctx.logger?.info?.(off ? 'atelier guardrails are OFF: full file access, approvals answered automatically' : 'atelier guardrails are on');
    for (const listener of [...state.listeners]) {
      try { listener(off); } catch (error) { ctx.logger?.warn?.('atelier-guardrails: %s', error?.message ?? error); }
    }
  };
  const schema = z.object({enabled: z.boolean().default(true).description('Atelier guardrails (on by default). Off: full file access and no approval prompts.')});
  installSettingsSection(ctx, GUARDRAILS_NS, schema, {enabled: true}, {setSource: next => { source = next; }, onChange: publish});

  // Approvals: answered before any prompt is shown, only while guardrails are off. Prepended so it runs before the
  // browser and terminal answerers; with guardrails on it hands the question on unchanged.
  ctx.inject(['approval'], actx => {
    actx.on('approval/request', (request, next) => answerApproval(state, next), {prepend: true});
  });

  // Chats: every open chat and every chat opened later follows the switch.
  ctx.inject(['permissionPresets', 'sessions'], pctx => {
    const presets = pctx.permissionPresets;
    const align = session => {
      try { alignSession(presets, session, state.off); } catch (error) { pctx.logger?.warn?.('atelier-guardrails: %s', error?.message ?? error); }
    };
    const alignAll = off => {
      if (off) syncOffPreset(presets, true);
      for (const session of pctx.sessions.list()) align(session);
      if (!off) syncOffPreset(presets, false);
    };
    pctx.on('session/created', session => { if (state.off) syncOffPreset(presets, true); align(session); });
    state.listeners.add(alignAll);
    pctx.effect(() => () => { state.listeners.delete(alignAll); });
    alignAll(state.off);
  });

  // Browser: the status (read by the chip and the Safety page) and the switch. The switch channel is a management
  // channel: Bottega never forwards it to a paired device, so only the person at this computer can change it.
  ctx.inject(['connection'], cctx => cctx.effect(() => cctx.connection.rpc.handle('/atelier-guardrails', async (endpoint, payload) => {
    try {
      if (endpoint === 'status') return {ok: true, value: {enabled: !state.off, warning: WARNING}};
      if (endpoint === 'set') {
        if (typeof payload?.enabled !== 'boolean') throw Error('Say whether guardrails should be on or off.');
        if (payload.enabled === false && payload.confirmed !== true) throw Error('Turning guardrails off needs your confirmation.');
        const settings = cctx.get('settings');
        if (!settings) throw Error('Settings are not available in this Atelier mode.');
        await settings.mutate(GUARDRAILS_NS, [{op: 'set', path: ['enabled'], value: payload.enabled}]);
        publish(); // the settings watcher publishes it too; this makes it immediate when the value is already resolved
        return {ok: true, value: {enabled: payload.enabled, warning: WARNING}};
      }
      throw Error('Unknown guardrails operation.');
    } catch (error) { return {ok: false, error: {code: 'bad-request', message: error.message}}; }
  }), 'atelier-guardrails rpc'));
}
