// Where this copy of Atelier runs from and where its user data lives. Mirrors the launchers:
//   installed (Windows)  %LOCALAPPDATA%\Programs\Atelier-Preview\versions\<v>\app, data in %APPDATA%\Atelier-Preview
//   installed (Linux)    ~/.local/share/atelier-preview/versions/<v>/app,       data in ~/.config/atelier-preview
//   from a checkout      <repo>, data in <repo>/user-home (what `pnpm start` uses)
// ATELIER_HOME always wins, exactly as it does for start-preview.mjs. DSH_HOME is ignored on purpose, so an existing
// DeepSeek Harness install is never touched.
import {existsSync, readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {basename, dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

/** The Atelier app root (the folder with start-preview.mjs): public/atelier-cli/src -> three levels up. */
export const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const readJson = path => { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return undefined; } };

/** The install root when this app sits in <root>/versions/<version>/app, else undefined. */
export function installRoot(env = process.env, appRoot = APP_ROOT) {
  if (env.ATELIER_INSTALL_ROOT) return resolve(env.ATELIER_INSTALL_ROOT);
  const versions = dirname(dirname(appRoot));
  if (basename(appRoot) === 'app' && basename(versions) === 'versions' && existsSync(join(dirname(versions), 'current'))) return dirname(versions);
  return undefined;
}

/** The installed per-user data folder the launchers use (also where `atelier` keeps chats when installed). */
export function installedDataDir(env = process.env, platform = process.platform) {
  if (env.ATELIER_DATA_DIR) return resolve(env.ATELIER_DATA_DIR);
  if (platform === 'win32') return join(env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'Atelier-Preview');
  return join(env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'atelier-preview');
}

/**
 * Atelier's home folder: chats, settings.yaml, keys. The web app and the terminal share it, which is what lets a
 * chat started in one open in the other.
 */
export function atelierHome(env = process.env, appRoot = APP_ROOT, platform = process.platform) {
  if (env.ATELIER_HOME) return resolve(env.ATELIER_HOME);
  if (installRoot(env, appRoot)) return installedDataDir(env, platform);
  return join(appRoot, 'user-home');
}

/** Versions shown by `atelier --version`. */
export function versions(appRoot = APP_ROOT) {
  const atelier = readJson(join(appRoot, 'package.json'))?.version ?? '0.0.0';
  const dsh = readJson(join(appRoot, 'harness', 'apps', 'cli', 'package.json'))?.version ?? 'unknown';
  return {atelier, plain: String(atelier).replace(/^v/, '').replace(/-preview$/, ''), dsh};
}

export const versionLine = (v = versions()) => `Atelier ${v.plain} by ARCITECH — powered by DSH ${v.dsh}`;

/** The upstream DSH launcher this CLI builds on, and Atelier's own web launcher. */
export const DSH_BIN = join(APP_ROOT, 'harness', 'apps', 'cli', 'lib', 'bin.js');
export const START_PREVIEW = join(APP_ROOT, 'start-preview.mjs');
