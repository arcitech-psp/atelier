import {join, resolve} from 'node:path';
import {ProfileDefaults, chooseProfile, installSessionDefault} from './store.mjs';

export const name = 'atelier-workspace-profiles';
export const inject = ['workspaceRegistry', 'agentPresets', 'sessionController'];

export function apply(ctx, config = {}) {
  const home = config.home || process.env.DSH_HOME || process.env.ATELIER_HOME;
  if (!home) throw Error('Set the application home before mounting workspace profiles.');
  const defaults = new ProfileDefaults(join(resolve(home), 'workspace-profile-defaults.json'));
  const registry = ctx.get('workspaceRegistry'), presets = ctx.get('agentPresets'), controller = ctx.get('sessionController');
  const globalDefault = () => config.globalDefault || process.env.ATELIER_DEFAULT_PROFILE
    || ((config.channel || process.env.ATELIER_UPDATE_CHANNEL) === 'dev' ? 'clippy' : 'vitruvius');
  ctx.effect(() => installSessionDefault(controller, request => chooseProfile(request, {registry, defaults, globalDefault, presets})));
  async function validate(profile) {
    if (profile === null) return;
    if (typeof profile !== 'string' || !profile || profile.length > 100) throw Error('Choose a profile or Use global default.');
    const row = await presets.resolve(profile);
    if (row.broken) throw Error(`Profile "${profile}" is unavailable: ${row.broken}`);
  }
  async function status() {
    const state = await defaults.read();
    return {globalDefault: globalDefault(), profiles: (await presets.list()).map(p => ({id: p.id, name: p.name || p.id, broken: p.broken ?? null})),
      workspaces: registry.list().map(w => ({id: w.id, title: w.title, path: w.path, defaultProfile: state.defaults[w.id] ?? null}))};
  }
  ctx.inject(['connection'], child => child.effect(() => child.connection.rpc.handle('/atelier-workspace-profiles', async (method, input = {}) => {
    try {
      if (method === 'status') return {ok: true, value: await status()};
      if (method === 'set') {
        if (!registry.get(input.workspaceId)) throw Error('Workspace not found.');
        await validate(input.profile);
        await defaults.set(input.workspaceId, input.profile);
      } else if (method === 'create') {
        await validate(input.profile);
        if (typeof input.path !== 'string' || !input.path.trim()) throw Error('Choose an existing project folder.');
        const before = await registry.resolveByPath(input.path);
        if (before) throw Error('This folder is already a workspace; edit its default below.');
        const workspace = await registry.create(input.path);
        try { await defaults.set(workspace.id, input.profile); }
        catch (error) { await registry.delete(workspace.id); throw error; }
      } else throw Error('Unknown workspace profile operation.');
      return {ok: true, value: await status()};
    } catch (error) { return {ok: false, error: {code: 'workspace-profile', message: error.message}}; }
  })));
}
