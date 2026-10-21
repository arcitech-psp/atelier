// `atelier profile`: which profile new chats start in.
//   vitruvius       the full design assistant (agent preset "vitruvius") on your own model
//   vitruvius-zero  the light start for small models (agent preset "vitruvius-zero") on your own model
//   cloud           Vitruvius on cloud AI through OmniRoute or your ChatGPT plan (profiles/cloud), no local model
// The choice lives in settings.yaml (agent-presets.default and, for cloud, agent-default-model), the same keys the
// launcher writes on first run, so the web app's profile list and new chats follow it.
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {parse as parseYaml} from 'yaml';
import {APP_ROOT} from './paths.mjs';
import {mutateSettings, readCliState, readSettings, writeCliState} from './settings.mjs';

export const PROFILES = [
  {id: 'vitruvius', name: 'Vitruvius', description: 'The full design assistant, on your own model.'},
  {id: 'vitruvius-zero', name: 'Vitruvius Zero', description: 'The lightest start, for small local models and modest computers.'},
  {id: 'einsteinium', name: 'Einsteinium', description: 'Research codes, regulations and data for any jurisdiction you name, with sources.'},
  {id: 'picaso', name: 'Picaso', description: 'Image concepts, moodboards and presentation direction.'},
  {id: 'hydra', name: 'Hydra', description: 'Plan, write, debug and review code in your project workspace.'},
  {id: 'cloud', name: 'Cloud', description: 'Vitruvius on cloud AI (OmniRoute free tiers, your keys or your ChatGPT plan). Your messages leave this computer.'},
];
const AGENT_PRESETS = new Set(['vitruvius', 'vitruvius-zero', 'einsteinium', 'picaso', 'hydra']);

const CLOUD_BRIDGE = '127.0.0.1:18345';
const cloudSettings = () => parseYaml(readFileSync(join(APP_ROOT, 'profiles', 'cloud', 'settings.yaml'), 'utf8'));

/** Which profile is active, judged from settings.yaml. */
export function currentProfile(settings) {
  const pick = settings?.['agent-default-model'];
  const provider = pick?.provider && settings?.['llm-pi-ai']?.providers?.[pick.provider];
  if (provider && String(provider.baseURL ?? '').includes(CLOUD_BRIDGE)) return 'cloud';
  const preset = settings?.['agent-presets']?.default;
  return AGENT_PRESETS.has(preset) ? preset : 'vitruvius';
}

export function listProfiles(home) {
  const active = currentProfile(readSettings(home));
  return PROFILES.map(p => ({...p, active: p.id === active}));
}

/**
 * Switch profile. Moving to cloud adds the cloud routes (never removing yours) and remembers your own model, so
 * moving back to vitruvius or vitruvius-zero restores it.
 * @returns {Promise<{profile: string, notes: string[]}>}
 */
export async function useProfile(home, id) {
  if (!PROFILES.some(p => p.id === id)) throw Error(`Unknown profile "${id}". Profiles: ${PROFILES.map(p => p.id).join(', ')}.`);
  const notes = [];
  const before = readSettings(home);
  const wasCloud = currentProfile(before) === 'cloud';
  if (id === 'cloud') {
    const cloud = cloudSettings();
    if (!wasCloud && before['agent-default-model']?.provider) await writeCliState(home, {ownModel: before['agent-default-model']});
    await mutateSettings(home, doc => {
      for (const [name, provider] of Object.entries(cloud['llm-pi-ai'].providers)) {
        if (!doc.hasIn(['llm-pi-ai', 'providers', name])) doc.setIn(['llm-pi-ai', 'providers', name], doc.createNode(provider));
      }
      doc.setIn(['agent-default-model', 'provider'], cloud['agent-default-model'].provider);
      doc.setIn(['agent-default-model', 'model'], cloud['agent-default-model'].model);
      doc.setIn(['agent-presets', 'default'], 'vitruvius');
    });
    notes.push('Cloud routes go through a small local bridge that Atelier starts with the web app (atelier web, or the desktop launcher).');
    notes.push('Add free-tier keys in OmniRoute (http://localhost:20128), or sign in with your ChatGPT plan at http://127.0.0.1:18345/signin.');
    notes.push('Your messages are sent to the cloud provider you pick.');
    return {profile: id, notes};
  }
  const own = readCliState(home).ownModel;
  await mutateSettings(home, doc => {
    doc.setIn(['agent-presets', 'default'], id);
    if (wasCloud) {
      if (own?.provider && own?.model) {
        doc.setIn(['agent-default-model', 'provider'], own.provider);
        doc.setIn(['agent-default-model', 'model'], own.model);
      } else if (doc.hasIn(['llm-pi-ai', 'providers', 'atelier-brain'])) {
        doc.setIn(['agent-default-model', 'provider'], 'atelier-brain');
        const model = doc.getIn(['llm-pi-ai', 'providers', 'atelier-brain', 'models', 0, 'id']);
        if (model) doc.setIn(['agent-default-model', 'model'], model);
      }
    }
  });
  if (wasCloud) {
    const after = readSettings(home);
    if (currentProfile(after) === 'cloud') notes.push('No model of your own is set yet. Connect one with: atelier roles set brain --url <address> --model <name>');
    else notes.push(`New chats use your own model again (${after['agent-default-model']?.model}).`);
  }
  notes.push(`New chats start in ${PROFILES.find(p => p.id === id).name}${id === 'vitruvius-zero' ? ', the lightest profile' : ''}.`);
  return {profile: id, notes};
}
