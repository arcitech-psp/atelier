// `atelier settings set guardrails on|off`: the Atelier guardrails switch, kept in settings.yaml exactly where
// Settings > Safety keeps it (atelier-guardrails: {enabled}). A running Atelier watches settings.yaml and applies the
// change at once. What the switch does is described in public/atelier-start/guardrails.mjs.
import {mutateSettings, readSettings} from './settings.mjs';

export const SECTION = 'atelier-guardrails';
/** The same words as WARNING in public/atelier-start/guardrails.mjs (a test keeps them identical). */
export const WARNING = 'Turning off Atelier guardrails unlocks the full potential of the AI model: it can read, change and delete '
  + 'files anywhere on this computer and run any command without asking you. This could damage your computer or your '
  + 'work. Only turn this off if you understand the risk and trust the model you connected.';

/** True when guardrails are on (the default: no section, or anything but `enabled: false`). */
export function readGuardrails(home) {
  return readSettings(home)?.[SECTION]?.enabled !== false;
}

/**
 * Switch guardrails on or off. The caller asks for confirmation before turning them off.
 * @returns whether settings.yaml changed.
 */
export async function setGuardrails(home, on) {
  return mutateSettings(home, doc => {
    if ((doc.getIn([SECTION, 'enabled']) !== false) === on && (on || doc.hasIn([SECTION, 'enabled']))) return false;
    doc.setIn([SECTION, 'enabled'], on);
    return true;
  });
}
