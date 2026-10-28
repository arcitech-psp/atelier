import {mkdir, readFile, rename, writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';

/** One durable setting per workspace ID. IDs survive renames and path moves. */
export class ProfileDefaults {
  constructor(file) { this.file = file; this.tail = Promise.resolve(); }
  async read() {
    try {
      const state = JSON.parse(await readFile(this.file, 'utf8'));
      if (state.format !== 1 || !state.defaults || typeof state.defaults !== 'object' || Array.isArray(state.defaults)) throw Error('Invalid workspace profile settings.');
      return state;
    } catch (error) { if (error.code === 'ENOENT') return {format: 1, defaults: {}}; throw error; }
  }
  set(workspaceId, profile) {
    const run = this.tail.then(async () => {
      const state = await this.read();
      if (profile === null) delete state.defaults[workspaceId];
      else state.defaults[workspaceId] = profile;
      await mkdir(dirname(this.file), {recursive: true});
      const temp = `${this.file}.${randomUUID()}.tmp`;
      await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, {mode: 0o600});
      await rename(temp, this.file);
      return profile;
    });
    this.tail = run.catch(() => {});
    return run;
  }
}

/** Compose only new sessions; idempotent adoption and explicit choices retain their contract. */
export async function chooseProfile(request, {registry, defaults, globalDefault, presets}) {
  if (request.agentPreset !== undefined || request.sessionId !== undefined) return request;
  let workspace;
  if (request.workspaceId !== undefined) {
    workspace = registry.get(request.workspaceId);
    if (!workspace) return request; // Let the host preserve its typed workspace-not-found error.
  } else if (request.cwd !== undefined) workspace = await registry.resolveByPath(request.cwd);
  const state = await defaults.read();
  const selected = workspace && state.defaults[workspace.id] || globalDefault();
  const resolved = await presets.resolve(selected);
  if (resolved.broken) throw Error(`The default profile "${selected}" is unavailable: ${resolved.broken}`);
  return {...request, agentPreset: resolved.id};
}

/** Reversible adapter on the public Service method used by the authenticated remote gateway. */
export function installSessionDefault(controller, resolveRequest) {
  const descriptor = Object.getOwnPropertyDescriptor(controller, 'create');
  const original = controller.create;
  const adapted = async function(request) { return original.call(this, await resolveRequest(request)); };
  controller.create = adapted;
  return () => {
    if (controller.create !== adapted) return;
    if (descriptor) Object.defineProperty(controller, 'create', descriptor);
    else delete controller.create;
  };
}
