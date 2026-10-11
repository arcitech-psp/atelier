// settings.yaml and roles.json, read and changed the same way the web app changes them: under the harness's
// cross-process writer lock (<file>.lock), with an atomic rename, keeping your comments. A running Atelier watches
// settings.yaml and picks the change up without a restart.
import {mkdirSync, readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {parseDocument} from 'yaml';
import {withFileLock, writeFileAtomic} from '@deepseek-ai/dsh-atomic-write';

export const settingsPath = home => join(home, 'settings.yaml');
export const rolesPath = home => join(home, 'atelier-roles', 'roles.json');
export const cliStatePath = home => join(home, 'atelier-cli.json');

const readText = path => { try { return readFileSync(path, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return undefined; throw error; } };

/** Parsed settings.yaml as plain data ({} when the file does not exist yet). */
export function readSettings(home) {
  const text = readText(settingsPath(home));
  if (text === undefined) return {};
  const doc = parseDocument(text);
  if (doc.errors.length) throw Error(`settings.yaml could not be read: ${doc.errors[0].message}`);
  return doc.toJS() ?? {};
}

/**
 * Change settings.yaml. `edit` receives the yaml Document (use doc.setIn / doc.getIn / doc.deleteIn) and may return
 * false to skip writing.
 */
export async function mutateSettings(home, edit) {
  const file = settingsPath(home);
  mkdirSync(dirname(file), {recursive: true, mode: 0o700});
  return withFileLock(file, async () => {
    const doc = parseDocument(readText(file) ?? '');
    if (doc.errors.length) throw Error(`settings.yaml could not be read, so it was left as it is: ${doc.errors[0].message}`);
    if (doc.contents === null) doc.contents = doc.createNode({});
    const result = await edit(doc);
    if (result === false) return false;
    await writeFileAtomic(file, String(doc), {mode: 0o600, dirMode: 0o700});
    return true;
  });
}

/** roles.json as the Model roles page keeps it: {roles: {<id>: {baseURL, model, ...}}, kit: {...}}. */
export function readRoles(home) {
  const text = readText(rolesPath(home));
  if (text === undefined) return {roles: {}, kit: {}};
  const value = JSON.parse(text);
  return {...value, roles: value.roles ?? {}, kit: value.kit ?? {}};
}

export async function mutateRoles(home, edit) {
  const file = rolesPath(home);
  mkdirSync(dirname(file), {recursive: true, mode: 0o700});
  return withFileLock(file, async () => {
    const text = readText(file);
    const value = text === undefined ? {roles: {}, kit: {}} : JSON.parse(text);
    value.roles ??= {};
    await edit(value);
    await writeFileAtomic(file, JSON.stringify(value, null, 2), {mode: 0o600, dirMode: 0o700});
    return value;
  });
}

/** Small private state of the terminal client (e.g. which model the cloud profile replaced). */
export function readCliState(home) {
  try { return JSON.parse(readFileSync(cliStatePath(home), 'utf8')); } catch { return {}; }
}

export async function writeCliState(home, patch) {
  const file = cliStatePath(home);
  mkdirSync(dirname(file), {recursive: true, mode: 0o700});
  const next = {...readCliState(home), ...patch};
  await writeFileAtomic(file, JSON.stringify(next, null, 2), {mode: 0o600, dirMode: 0o700});
  return next;
}
